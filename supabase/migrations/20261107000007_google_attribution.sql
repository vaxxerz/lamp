-- =============================================================
-- 등잔(Lamp) — 7. 구글 문서 기여 배분 정밀화 (Drive Activity API + 자체 스냅샷)
--
--  문제: Drive revision은 짧은 시간의 편집을 합치고, 수정자를 한 명(lastModifyingUser)만 남김
--  해결
--   1) 자체 스냅샷: 문서를 연결한 뒤에는 동기화 때마다 현재 본문을 export해 직전 스냅샷과 diff
--      → 구글이 나중에 revision을 합쳐도 우리 구간은 그대로 남음
--      (연결 이전 구간은 기존처럼 revision으로 소급, snapshot_since로 경계를 나눠 중복 집계 방지)
--   2) Drive Activity API: 구간 안에 실제로 편집한 사람 목록과 편집 시간
--   3) 배분: 구간의 diff를 편집자별 "구간과 겹친 편집 시간" 비율로 나눔 (계산은 서버 TS)
--      → external_doc_credits에 사람별로 저장, 이 행이 activity_events의 근거(ref)
--
--  confidence
--   single   : 구간 편집자 1명 → 100%
--   shared   : 여러 명 → 시간 비율로 나눈 추정치
--   fallback : Activity 정보 없음 → revision/파일의 lastModifyingUser 1명에게
-- =============================================================

-- ---------- 컬럼 · 테이블 ----------
-- Activity API는 편집자를 people/{id}로 줌. OAuth의 sub(구글 계정 ID)를 저장해 매칭.
alter table public.google_accounts add column activity_person_id text unique;

alter table public.external_docs
  add column snapshot_text        text,         -- 직전 자체 스냅샷 본문 (null = 아직 기준 없음)
  add column snapshot_at          timestamptz,  -- 직전 스냅샷을 찍은 시각 (다음 구간의 시작)
  add column snapshot_modified_at timestamptz,  -- 그때의 Drive modifiedTime (바뀌었을 때만 export)
  add column snapshot_since       timestamptz;  -- 첫 스냅샷 시각. 이후는 스냅샷, 이전은 revision이 담당

alter table public.external_doc_revisions
  add column source            text not null default 'revision' check (source in ('revision', 'snapshot')),
  add column period_start      timestamptz,     -- 구간 시작 (null = 문서 처음부터)
  add column attribution_final boolean not null default true;  -- false면 Activity 지연 대비 재배분 대상

-- 구간(revision 또는 스냅샷) 1건을 사람별로 나눈 결과
create table public.external_doc_credits (
  id             uuid primary key default gen_random_uuid(),
  revision_id    uuid not null references public.external_doc_revisions (id) on delete cascade,
  team_id        uuid not null references public.teams (id) on delete cascade,
  author_id      uuid references public.profiles (id),
  person_id      text,                -- Activity API people/{id}의 id
  permission_id  text,                -- fallback일 때 Drive permissionId
  display_name   text,
  chars_added    int not null default 0 check (chars_added >= 0),
  chars_removed  int not null default 0 check (chars_removed >= 0),
  share          numeric not null check (share >= 0 and share <= 1),
  confidence     text not null check (confidence in ('single', 'shared', 'fallback')),
  created_at     timestamptz not null default now()
);
create index external_doc_credits_revision_idx on public.external_doc_credits (revision_id);
create index external_doc_credits_unmatched_idx on public.external_doc_credits (team_id) where author_id is null;

-- ---------- 내부 함수 ----------
-- Activity person id 또는 permissionId → 팀원
create or replace function public.resolve_google_member(p_team_id uuid, p_person_id text, p_permission_id text)
returns uuid language sql stable security definer set search_path = '' as $$
  select ga.user_id
  from public.google_accounts ga
  join public.team_members tm on tm.user_id = ga.user_id and tm.team_id = p_team_id
  where (p_person_id is not null and ga.activity_person_id = p_person_id)
     or (p_person_id is null and p_permission_id is not null and ga.permission_id = p_permission_id)
  limit 1
$$;

-- credit 1건을 팀원에게 귀속 + 활동 이벤트 기록
create or replace function public.credit_external_credit(p_credit_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  c public.external_doc_credits%rowtype;
  r public.external_doc_revisions%rowtype;
  d public.external_docs%rowtype;
  v_author uuid;
  v_eff numeric;
begin
  select * into c from public.external_doc_credits where id = p_credit_id;
  if not found then return false; end if;
  select * into r from public.external_doc_revisions where id = c.revision_id;
  select * into d from public.external_docs where id = r.external_doc_id;

  v_author := coalesce(c.author_id, public.resolve_google_member(c.team_id, c.person_id, c.permission_id));
  if v_author is null then return false; end if;
  if c.author_id is null then
    update public.external_doc_credits set author_id = v_author where id = c.id;
  end if;

  v_eff := c.chars_added + 0.5 * c.chars_removed;
  if v_eff > 0 then
    perform public.record_event(c.team_id, v_author, public.external_category(d.mime_type),
      'external_doc_edit', round(v_eff), 'external_doc_credits', c.id,
      jsonb_build_object('provider', 'google', 'external_doc_id', d.id, 'title', d.title,
                         'web_url', d.web_url, 'modified_at', r.modified_at, 'revision_id', r.id,
                         'source', r.source, 'confidence', c.confidence, 'share', c.share,
                         'chars_added', c.chars_added, 'chars_removed', c.chars_removed));
  end if;
  return true;
end
$$;

-- 구간의 배분을 통째로 교체 (재배분 시 이전 이벤트도 지움).
-- p_credits가 null이면 구간의 lastModifyingUser 1명에게 전부 (fallback)
create or replace function public.replace_revision_credits(p_revision_id uuid, p_credits jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.external_doc_revisions%rowtype;
  v_credit uuid;
begin
  select * into r from public.external_doc_revisions where id = p_revision_id;
  if not found then return; end if;

  delete from public.activity_events
   where ref_table = 'external_doc_credits'
     and ref_id in (select id from public.external_doc_credits where revision_id = r.id);
  delete from public.external_doc_credits where revision_id = r.id;

  if p_credits is null then
    p_credits := jsonb_build_array(jsonb_build_object(
      'person_id', null, 'permission_id', r.google_permission_id, 'display_name', r.google_display_name,
      'chars_added', r.chars_added, 'chars_removed', r.chars_removed, 'share', 1, 'confidence', 'fallback'));
  end if;

  for v_credit in
    insert into public.external_doc_credits
      (revision_id, team_id, person_id, permission_id, display_name, chars_added, chars_removed, share, confidence)
    select r.id, r.team_id, x.person_id, x.permission_id, x.display_name,
           greatest(coalesce(x.chars_added, 0), 0), greatest(coalesce(x.chars_removed, 0), 0),
           least(greatest(coalesce(x.share, 0), 0), 1), x.confidence
    from jsonb_to_recordset(p_credits)
      as x(person_id text, permission_id text, display_name text,
           chars_added int, chars_removed int, share numeric, confidence text)
    returning id
  loop
    perform public.credit_external_credit(v_credit);
  end loop;

  -- 화면 호환: revision의 대표 작성자 = 가장 큰 몫을 받은 팀원
  update public.external_doc_revisions
     set author_id = (select author_id from public.external_doc_credits
                       where revision_id = r.id and author_id is not null
                       order by share desc, chars_added desc limit 1)
   where id = r.id;
end
$$;

-- ---------- 서버 전용 RPC (service_role) ----------
-- revision 경로: 기존 시그니처에 배분 결과(p_credits)를 추가
drop function public.record_external_revision(uuid, text, timestamptz, text, text, text, int, int, boolean, text);
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
  p_new_text             text,              -- null이면 last_text 유지 (export 실패)
  p_credits              jsonb default null,  -- null이면 lastModifyingUser에게 전부
  p_period_start         timestamptz default null
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
     chars_added, chars_removed, text_available, source, period_start)
  values
    (d.id, d.team_id, p_revision_id, p_modified_at,
     p_permission_id, p_display_name, p_email,
     greatest(coalesce(p_chars_added, 0), 0), greatest(coalesce(p_chars_removed, 0), 0),
     coalesce(p_text_available, false), 'revision', p_period_start)
  on conflict (external_doc_id, external_revision_id) do nothing
  returning id into v_id;

  update public.external_docs
     set last_revision_id = p_revision_id,
         last_text = coalesce(p_new_text, last_text),
         last_synced_at = now()
   where id = d.id;

  if v_id is not null then
    perform public.replace_revision_credits(v_id, p_credits);
  end if;
  return v_id;
end
$$;

-- 스냅샷 기준만 갱신 (첫 기준, 또는 본문 변화 없음). 다른 동기화가 먼저 갱신했으면 false.
create or replace function public.set_snapshot_state(
  p_external_doc_id   uuid,
  p_expected_at       timestamptz,   -- 읽어 둔 snapshot_at (null = 기준 없음)
  p_text              text,
  p_drive_modified_at timestamptz,
  p_taken_at          timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  d public.external_docs%rowtype;
begin
  select * into d from public.external_docs where id = p_external_doc_id for update;
  if not found then
    raise exception 'external_doc_not_found' using errcode = 'P0002';
  end if;
  if d.snapshot_at is distinct from p_expected_at then return false; end if;

  update public.external_docs
     set snapshot_text = p_text,
         snapshot_at = p_taken_at,
         snapshot_modified_at = p_drive_modified_at,
         snapshot_since = coalesce(snapshot_since, p_taken_at),
         last_synced_at = now()
   where id = d.id;
  return true;
end
$$;

-- 스냅샷 구간 1건 기록 + 배분 + 기준 갱신 (원자적). 다른 동기화가 먼저 갱신했으면 null.
create or replace function public.record_snapshot_segment(
  p_external_doc_id   uuid,
  p_period_start      timestamptz,   -- 읽어 둔 snapshot_at (= 구간 시작)
  p_taken_at          timestamptz,   -- 구간 끝 (이번 스냅샷 시각)
  p_drive_modified_at timestamptz,
  p_permission_id     text,          -- fallback용 파일 lastModifyingUser
  p_display_name      text,
  p_email             text,
  p_chars_added       int,
  p_chars_removed     int,
  p_new_text          text,
  p_credits           jsonb,
  p_final             boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.external_docs%rowtype;
  v_id uuid;
begin
  select * into d from public.external_docs where id = p_external_doc_id for update;
  if not found then
    raise exception 'external_doc_not_found' using errcode = 'P0002';
  end if;
  if d.snapshot_at is distinct from p_period_start then return null; end if;

  insert into public.external_doc_revisions
    (external_doc_id, team_id, external_revision_id, modified_at,
     google_permission_id, google_display_name, google_email,
     chars_added, chars_removed, text_available, source, period_start, attribution_final)
  values
    (d.id, d.team_id, 'snap:' || to_char(p_taken_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     p_taken_at, p_permission_id, p_display_name, p_email,
     greatest(coalesce(p_chars_added, 0), 0), greatest(coalesce(p_chars_removed, 0), 0),
     true, 'snapshot', p_period_start, coalesce(p_final, true))
  on conflict (external_doc_id, external_revision_id) do nothing
  returning id into v_id;

  update public.external_docs
     set snapshot_text = p_new_text,
         snapshot_at = p_taken_at,
         snapshot_modified_at = p_drive_modified_at,
         last_synced_at = now()
   where id = d.id;

  if v_id is not null then
    perform public.replace_revision_credits(v_id, p_credits);
  end if;
  return v_id;
end
$$;

-- Activity 지연으로 미확정이던 구간을 다시 배분
create or replace function public.set_revision_credits(p_revision_id uuid, p_credits jsonb, p_final boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.replace_revision_credits(p_revision_id, p_credits);
  update public.external_doc_revisions set attribution_final = coalesce(p_final, true) where id = p_revision_id;
end
$$;

-- 구글 계정 저장: activity_person_id 추가. 연결 시 매칭 안 됐던 과거 배분도 소급.
drop function public.save_google_account(uuid, text, text, text, text, text);
create or replace function public.save_google_account(
  p_user_id           uuid,
  p_google_email      text,
  p_permission_id     text,
  p_display_name      text,
  p_refresh_token_enc text,
  p_scope             text,
  p_person_id         text default null
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_credited int := 0;
begin
  if exists (
    select 1 from public.google_accounts
     where user_id <> p_user_id
       and (permission_id = p_permission_id or (p_person_id is not null and activity_person_id = p_person_id))
  ) then
    raise exception 'google_account_in_use' using errcode = '23505';
  end if;

  insert into public.google_accounts
    (user_id, google_email, permission_id, display_name, refresh_token_enc, scope, activity_person_id)
  values
    (p_user_id, p_google_email, p_permission_id, p_display_name, p_refresh_token_enc, p_scope, p_person_id)
  on conflict (user_id) do update
    set google_email = excluded.google_email,
        permission_id = excluded.permission_id,
        display_name = excluded.display_name,
        refresh_token_enc = excluded.refresh_token_enc,
        scope = excluded.scope,
        activity_person_id = coalesce(excluded.activity_person_id, public.google_accounts.activity_person_id),
        connected_at = now();

  -- 이번 마이그레이션 이전 revision (배분 행 없음)
  for v_id in
    select r.id from public.external_doc_revisions r
    join public.team_members tm on tm.team_id = r.team_id and tm.user_id = p_user_id
    where r.author_id is null and r.google_permission_id = p_permission_id
      and not exists (select 1 from public.external_doc_credits c where c.revision_id = r.id)
  loop
    if public.credit_external_revision(v_id) then v_credited := v_credited + 1; end if;
  end loop;

  -- 배분 행
  for v_id in
    select c.id from public.external_doc_credits c
    join public.team_members tm on tm.team_id = c.team_id and tm.user_id = p_user_id
    where c.author_id is null
      and ((p_person_id is not null and c.person_id = p_person_id)
        or (c.person_id is null and c.permission_id = p_permission_id))
  loop
    if public.credit_external_credit(v_id) then v_credited := v_credited + 1; end if;
  end loop;
  return v_credited;
end
$$;

-- ---------- RLS ----------
alter table public.external_doc_credits enable row level security;
create policy external_doc_credits_select on public.external_doc_credits for select to authenticated
  using (public.can_view_team(team_id));
revoke all on public.external_doc_credits from anon;
revoke insert, update, delete on public.external_doc_credits from authenticated;
-- activity_person_id도 클라이언트에 노출하지 않음 (기존 컬럼 권한 유지)

-- ---------- 함수 권한 ----------
revoke execute on function
  public.resolve_google_member(uuid, text, text),
  public.credit_external_credit(uuid),
  public.replace_revision_credits(uuid, jsonb),
  public.record_external_revision(uuid, text, timestamptz, text, text, text, int, int, boolean, text, jsonb, timestamptz),
  public.set_snapshot_state(uuid, timestamptz, text, timestamptz, timestamptz),
  public.record_snapshot_segment(uuid, timestamptz, timestamptz, timestamptz, text, text, text, int, int, text, jsonb, boolean),
  public.set_revision_credits(uuid, jsonb, boolean),
  public.save_google_account(uuid, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.record_external_revision(uuid, text, timestamptz, text, text, text, int, int, boolean, text, jsonb, timestamptz),
  public.set_snapshot_state(uuid, timestamptz, text, timestamptz, timestamptz),
  public.record_snapshot_segment(uuid, timestamptz, timestamptz, timestamptz, text, text, text, int, int, text, jsonb, boolean),
  public.set_revision_credits(uuid, jsonb, boolean),
  public.save_google_account(uuid, text, text, text, text, text, text)
to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.external_doc_credits;
  end if;
end
$$;
