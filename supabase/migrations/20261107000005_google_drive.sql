-- =============================================================
-- 등잔(Lamp) — 5. 구글 드라이브(문서 · 슬라이드 · 시트) 연동
--
--  흐름
--   1) 팀원이 구글 계정 연결 (OAuth, drive.file 스코프) → google_accounts
--   2) 팀원이 Google Picker로 문서 선택 → external_docs (팀에 연결)
--   3) 서버가 Drive API revisions.list로 수정 이력 수집 → 버전별 텍스트 export → diff
--      → external_doc_revisions + (작성자가 연결된 팀원이면) activity_events
--   4) 나중에 구글 계정을 연결한 팀원은 과거 수정 이력이 소급 반영됨
--
--  한계: 구글은 짧은 시간의 편집을 한 revision으로 합치고, 동시 편집 시 수정자를
--        한 명만 기록함 → 내부 문서보다 정밀도가 낮은 "보조 증거"로 취급
-- =============================================================

-- ---------- 테이블 ----------
-- 팀원 ↔ 구글 계정. refresh token은 서버 키(AES-256-GCM)로 암호화해 저장하며 클라이언트는 읽을 수 없음.
create table public.google_accounts (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  google_email       text not null,
  permission_id      text not null unique,        -- Drive가 revision 수정자를 식별하는 ID
  display_name       text,
  refresh_token_enc  text not null,
  scope              text,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 팀에 연결된 구글 문서
create table public.external_docs (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams (id) on delete cascade,
  provider          text not null default 'google' check (provider = 'google'),
  external_id       text not null,                -- Drive file id
  title             text not null,
  mime_type         text not null,                -- application/vnd.google-apps.document | presentation | spreadsheet
  web_url           text,
  linked_by         uuid not null references public.profiles (id),  -- 이 사람의 토큰으로 동기화
  last_revision_id  text,
  last_text         text not null default '',     -- 직전 revision 텍스트 (다음 diff 기준)
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  unique (team_id, external_id)
);

-- 구글 revision 1건 = 1행. 작성자를 팀원과 매칭하지 못하면 author_id = null 로 보관.
create table public.external_doc_revisions (
  id                    uuid primary key default gen_random_uuid(),
  external_doc_id       uuid not null references public.external_docs (id) on delete cascade,
  team_id               uuid not null references public.teams (id) on delete cascade,
  external_revision_id  text not null,
  modified_at           timestamptz not null,
  google_permission_id  text,
  google_display_name   text,
  google_email          text,
  author_id             uuid references public.profiles (id),
  chars_added           int not null default 0 check (chars_added >= 0),
  chars_removed         int not null default 0 check (chars_removed >= 0),
  text_available        boolean not null default false,  -- export 실패 시 false (수정 사실만 기록)
  created_at            timestamptz not null default now(),
  unique (external_doc_id, external_revision_id)
);
create index external_doc_revisions_doc_idx on public.external_doc_revisions (external_doc_id, modified_at desc);
create index external_doc_revisions_unmatched_idx on public.external_doc_revisions (google_permission_id)
  where author_id is null;

create trigger google_accounts_touch before update on public.google_accounts
  for each row execute function public.touch_updated_at();

-- ---------- 점수: external_doc_edit 추가 (나머지는 기존과 동일) ----------
create or replace function public.compute_points(
  p_type public.activity_type, p_amount numeric, p_meta jsonb
) returns numeric language sql immutable set search_path = '' as $$
  select round(case p_type
    when 'doc_edit'          then least(p_amount, 3000) / 100.0
    when 'meeting_note'      then least(p_amount, 3000) / 100.0
    -- 구글 revision은 여러 편집이 합쳐져 있으므로 내부 문서와 같은 상한 적용
    when 'external_doc_edit' then least(p_amount, 3000) / 100.0
    when 'task_create'       then 0.5
    when 'task_complete'     then case when coalesce((p_meta ->> 'verified')::boolean, false)
                                       then 3 else 1.5 end
    when 'meeting_attend'    then case when p_meta ->> 'status' = 'late' then 0.5 else 1 end
    when 'file_version'      then
      case when coalesce((p_meta ->> 'first')::boolean, false)
             or p_amount > 0
             or coalesce(jsonb_array_length(p_meta -> 'slides_changed'), 0)
              + coalesce(jsonb_array_length(p_meta -> 'slides_added'), 0) > 0
           then 2 else 0 end
      + least(p_amount, 5000) / 200.0
      + least(coalesce(jsonb_array_length(p_meta -> 'slides_changed'), 0)
            + coalesce(jsonb_array_length(p_meta -> 'slides_added'), 0), 20) * 0.5
    else 0
  end, 2)
$$;

-- 구글 문서 → 문서 카테고리, 슬라이드 · 시트 → 파일(결과물) 카테고리
create or replace function public.external_category(p_mime text)
returns public.activity_category language sql immutable set search_path = '' as $$
  select case when p_mime = 'application/vnd.google-apps.document'
              then 'document'::public.activity_category
              else 'file'::public.activity_category end
$$;

-- ---------- 내부: revision을 팀원에게 귀속 + 활동 이벤트 기록 ----------
create or replace function public.credit_external_revision(p_revision_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.external_doc_revisions%rowtype;
  d public.external_docs%rowtype;
  v_author uuid;
  v_eff numeric;
begin
  select * into r from public.external_doc_revisions where id = p_revision_id;
  if not found then return false; end if;
  select * into d from public.external_docs where id = r.external_doc_id;

  v_author := r.author_id;
  if v_author is null then
    select ga.user_id into v_author
    from public.google_accounts ga
    join public.team_members tm on tm.user_id = ga.user_id and tm.team_id = r.team_id
    where ga.permission_id = r.google_permission_id;
    if v_author is null then return false; end if;
    update public.external_doc_revisions set author_id = v_author where id = r.id;
  end if;

  v_eff := r.chars_added + 0.5 * r.chars_removed;
  if v_eff > 0 then
    perform public.record_event(r.team_id, v_author, public.external_category(d.mime_type),
      'external_doc_edit', round(v_eff), 'external_doc_revisions', r.id,
      jsonb_build_object('provider', 'google', 'external_doc_id', d.id, 'title', d.title,
                         'web_url', d.web_url, 'modified_at', r.modified_at,
                         'chars_added', r.chars_added, 'chars_removed', r.chars_removed));
  end if;
  return true;
end
$$;

-- ---------- 서버 전용 RPC (service_role) ----------
-- OAuth 콜백에서 호출. 연결 즉시 이 사람의 과거 구글 수정 이력을 소급 반영.
create or replace function public.save_google_account(
  p_user_id           uuid,
  p_google_email      text,
  p_permission_id     text,
  p_display_name      text,
  p_refresh_token_enc text,
  p_scope             text
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_rev uuid;
  v_credited int := 0;
begin
  if exists (
    select 1 from public.google_accounts where permission_id = p_permission_id and user_id <> p_user_id
  ) then
    raise exception 'google_account_in_use' using errcode = '23505';
  end if;

  insert into public.google_accounts
    (user_id, google_email, permission_id, display_name, refresh_token_enc, scope)
  values
    (p_user_id, p_google_email, p_permission_id, p_display_name, p_refresh_token_enc, p_scope)
  on conflict (user_id) do update
    set google_email = excluded.google_email,
        permission_id = excluded.permission_id,
        display_name = excluded.display_name,
        refresh_token_enc = excluded.refresh_token_enc,
        scope = excluded.scope,
        connected_at = now();

  for v_rev in
    select r.id from public.external_doc_revisions r
    join public.team_members tm on tm.team_id = r.team_id and tm.user_id = p_user_id
    where r.author_id is null and r.google_permission_id = p_permission_id
  loop
    if public.credit_external_revision(v_rev) then
      v_credited := v_credited + 1;
    end if;
  end loop;
  return v_credited;
end
$$;

create or replace function public.link_external_doc(
  p_team_id     uuid,
  p_user_id     uuid,
  p_external_id text,
  p_title       text,
  p_mime_type   text,
  p_web_url     text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id
  ) then
    raise exception 'not_team_member' using errcode = '42501';
  end if;
  if p_mime_type not in ('application/vnd.google-apps.document',
                         'application/vnd.google-apps.presentation',
                         'application/vnd.google-apps.spreadsheet') then
    raise exception 'unsupported_mime_type' using errcode = '22023';
  end if;

  insert into public.external_docs (team_id, external_id, title, mime_type, web_url, linked_by)
  values (p_team_id, p_external_id, p_title, p_mime_type, p_web_url, p_user_id)
  on conflict (team_id, external_id) do update
    set title = excluded.title,
        mime_type = excluded.mime_type,
        web_url = excluded.web_url,
        linked_by = excluded.linked_by          -- 다시 연결한 사람의 토큰으로 동기화
  returning id into v_id;
  return v_id;
end
$$;

-- 동기화 중 revision 1건 기록. 이미 있으면 null 반환 (멱등).
create or replace function public.record_external_revision(
  p_external_doc_id      uuid,
  p_revision_id          text,
  p_modified_at          timestamptz,
  p_permission_id        text,
  p_display_name         text,
  p_email                text,
  p_chars_added          int,
  p_chars_removed        int,
  p_text_available       boolean,
  p_new_text             text      -- null이면 last_text 유지 (export 실패)
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.external_docs%rowtype;
  v_id uuid;
begin
  select * into d from public.external_docs where id = p_external_doc_id for update;
  if not found then
    raise exception 'external_doc_not_found' using errcode = 'P0002';
  end if;

  insert into public.external_doc_revisions
    (external_doc_id, team_id, external_revision_id, modified_at,
     google_permission_id, google_display_name, google_email,
     chars_added, chars_removed, text_available)
  values
    (d.id, d.team_id, p_revision_id, p_modified_at,
     p_permission_id, p_display_name, p_email,
     greatest(coalesce(p_chars_added, 0), 0), greatest(coalesce(p_chars_removed, 0), 0),
     coalesce(p_text_available, false))
  on conflict (external_doc_id, external_revision_id) do nothing
  returning id into v_id;

  update public.external_docs
     set last_revision_id = p_revision_id,
         last_text = coalesce(p_new_text, last_text),
         last_synced_at = now()
   where id = d.id;

  if v_id is not null then
    perform public.credit_external_revision(v_id);
  end if;
  return v_id;
end
$$;

create or replace function public.touch_external_doc_synced(p_external_doc_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.external_docs set last_synced_at = now() where id = p_external_doc_id
$$;

-- ---------- 클라이언트 RPC: 팀원별 구글 연결 상태 ----------
create or replace function public.get_team_google_status(p_team_id uuid)
returns table (user_id uuid, name text, connected boolean, google_email text)
language sql stable security definer set search_path = '' as $$
  select tm.user_id, p.name, ga.user_id is not null, ga.google_email
  from public.team_members tm
  join public.profiles p on p.id = tm.user_id
  left join public.google_accounts ga on ga.user_id = tm.user_id
  where tm.team_id = p_team_id
    and (public.can_view_team(p_team_id) or public.is_service_role())
  order by p.name
$$;

-- ---------- RLS ----------
alter table public.google_accounts        enable row level security;
alter table public.external_docs          enable row level security;
alter table public.external_doc_revisions enable row level security;

-- 본인 연결 정보만 (토큰 컬럼은 컬럼 권한으로 차단), 연결 해제는 본인
create policy google_accounts_select on public.google_accounts for select to authenticated
  using (user_id = auth.uid());
create policy google_accounts_delete on public.google_accounts for delete to authenticated
  using (user_id = auth.uid());

create policy external_docs_select on public.external_docs for select to authenticated
  using (public.can_view_team(team_id));
create policy external_doc_revisions_select on public.external_doc_revisions for select to authenticated
  using (public.can_view_team(team_id));

revoke all on public.google_accounts, public.external_docs, public.external_doc_revisions from anon;
revoke all on public.google_accounts from authenticated;
grant select (user_id, google_email, display_name, connected_at) on public.google_accounts to authenticated;
grant delete on public.google_accounts to authenticated;
revoke insert, update, delete on public.external_docs, public.external_doc_revisions from authenticated;

-- ---------- 함수 권한 ----------
revoke execute on function
  public.external_category(text),
  public.credit_external_revision(uuid),
  public.save_google_account(uuid, text, text, text, text, text),
  public.link_external_doc(uuid, uuid, text, text, text, text),
  public.record_external_revision(uuid, text, timestamptz, text, text, text, int, int, boolean, text),
  public.touch_external_doc_synced(uuid),
  public.get_team_google_status(uuid)
from public, anon, authenticated;

grant execute on function public.compute_points(public.activity_type, numeric, jsonb) to authenticated;
grant execute on function public.get_team_google_status(uuid) to authenticated;
grant execute on function
  public.save_google_account(uuid, text, text, text, text, text),
  public.link_external_doc(uuid, uuid, text, text, text, text),
  public.record_external_revision(uuid, text, timestamptz, text, text, text, int, int, boolean, text),
  public.touch_external_doc_synced(uuid),
  public.get_team_google_status(uuid)
to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.external_docs, public.external_doc_revisions;
  end if;
end
$$;
