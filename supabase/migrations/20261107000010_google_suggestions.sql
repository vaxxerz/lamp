-- =============================================================
-- 등잔(Lamp) — 10. 구글 문서 제안(suggestion) 자동 기록 · 수락
--
--  팀원이 구글 문서에서 "제안 모드"로 쓰면 제안마다 작성자가 붙는다.
--   1) 워커가 2초마다 Docs API로 제안 목록을 읽고, 내용이 2.5초간 안 바뀌면(입력 끝) 처리
--   2) docx로 내보내 변경 내용 추적(w:ins / w:del)에서 제안 작성자 · 시각을 찾아 기록 (추정 없음)
--   3) Docs API acceptSuggestion으로 바로 수락 → 문서는 수정 모드처럼 깔끔하게 유지
--  기록된 제안은 스냅샷 diff 배분에서 빼서 중복 집계하지 않음 (sync.ts)
-- =============================================================

create table public.external_doc_suggestions (
  id               uuid primary key default gen_random_uuid(),
  external_doc_id  uuid not null references public.external_docs (id) on delete cascade,
  team_id          uuid not null references public.teams (id) on delete cascade,
  suggestion_id    text not null,                 -- Docs API suggestion id
  status           text not null default 'pending'
                   check (status in ('pending', 'accepted', 'gone')),
  added_text       text not null default '',
  removed_text     text not null default '',
  text_hash        text not null default '',      -- 내용이 바뀌면 stable_since 갱신 (입력 중 판단)
  first_seen_at    timestamptz not null default now(),
  stable_since     timestamptz not null default now(),
  -- 기록 (accepted)
  author_name      text,                          -- docx w:author (구글 계정 표시 이름)
  author_id        uuid references public.profiles (id),
  suggested_at     timestamptz,                   -- docx w:date
  chars_added      int not null default 0 check (chars_added >= 0),
  chars_removed    int not null default 0 check (chars_removed >= 0),
  accepted_at      timestamptz,
  unique (external_doc_id, suggestion_id)
);
create index external_doc_suggestions_doc_idx on public.external_doc_suggestions (external_doc_id, status);
create index external_doc_suggestions_accepted_idx on public.external_doc_suggestions (external_doc_id, accepted_at)
  where status = 'accepted';

-- docx 작성자 이름 → 팀원 (구글 계정 표시 이름 기준, 팀 안에서 유일할 때만)
create or replace function public.resolve_google_member_by_name(p_team_id uuid, p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select (array_agg(ga.user_id))[1]
  from public.google_accounts ga
  join public.team_members tm on tm.user_id = ga.user_id and tm.team_id = p_team_id
  where p_name is not null and ga.display_name = p_name
  having count(*) = 1
$$;

-- 제안 1건을 수락 기록 + 기여 이벤트 (서버 전용). 이미 기록됐으면 null.
create or replace function public.record_external_suggestion(
  p_external_doc_id uuid,
  p_suggestion_id   text,
  p_added_text      text,
  p_removed_text    text,
  p_chars_added     int,
  p_chars_removed   int,
  p_author_name     text,
  p_suggested_at    timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.external_docs%rowtype;
  v_id uuid;
  v_author uuid;
  v_eff numeric;
begin
  select * into d from public.external_docs where id = p_external_doc_id;
  if not found then
    raise exception 'external_doc_not_found' using errcode = 'P0002';
  end if;
  v_author := public.resolve_google_member_by_name(d.team_id, p_author_name);

  insert into public.external_doc_suggestions as s
    (external_doc_id, team_id, suggestion_id, status, added_text, removed_text,
     author_name, author_id, suggested_at, chars_added, chars_removed, accepted_at)
  values
    (d.id, d.team_id, p_suggestion_id, 'accepted', coalesce(p_added_text, ''), coalesce(p_removed_text, ''),
     p_author_name, v_author, p_suggested_at,
     greatest(coalesce(p_chars_added, 0), 0), greatest(coalesce(p_chars_removed, 0), 0), now())
  on conflict (external_doc_id, suggestion_id) do update
    set status = 'accepted',
        added_text = excluded.added_text,
        removed_text = excluded.removed_text,
        author_name = excluded.author_name,
        author_id = excluded.author_id,
        suggested_at = excluded.suggested_at,
        chars_added = excluded.chars_added,
        chars_removed = excluded.chars_removed,
        accepted_at = excluded.accepted_at
    where s.status <> 'accepted'
  returning s.id into v_id;

  if v_id is not null and v_author is not null then
    v_eff := greatest(coalesce(p_chars_added, 0), 0) + 0.5 * greatest(coalesce(p_chars_removed, 0), 0);
    if v_eff > 0 then
      perform public.record_event(d.team_id, v_author, public.external_category(d.mime_type),
        'external_doc_edit', round(v_eff), 'external_doc_suggestions', v_id,
        jsonb_build_object('provider', 'google', 'external_doc_id', d.id, 'title', d.title,
                           'web_url', d.web_url, 'source', 'suggestion', 'confidence', 'exact',
                           'suggested_at', p_suggested_at,
                           'chars_added', p_chars_added, 'chars_removed', p_chars_removed));
    end if;
  end if;
  return v_id;
end
$$;

-- 연결 시 이름으로 매칭 못 했던 제안 소급 (save_google_account와 별도로 호출)
create or replace function public.credit_pending_suggestions(p_user_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.external_doc_suggestions%rowtype;
  d public.external_docs%rowtype;
  v_n int := 0;
  v_eff numeric;
begin
  for s in
    select es.* from public.external_doc_suggestions es
    join public.team_members tm on tm.team_id = es.team_id and tm.user_id = p_user_id
    where es.status = 'accepted' and es.author_id is null
      and public.resolve_google_member_by_name(es.team_id, es.author_name) = p_user_id
  loop
    select * into d from public.external_docs where id = s.external_doc_id;
    update public.external_doc_suggestions set author_id = p_user_id where id = s.id;
    v_eff := s.chars_added + 0.5 * s.chars_removed;
    if v_eff > 0 then
      perform public.record_event(s.team_id, p_user_id, public.external_category(d.mime_type),
        'external_doc_edit', round(v_eff), 'external_doc_suggestions', s.id,
        jsonb_build_object('provider', 'google', 'external_doc_id', d.id, 'title', d.title,
                           'source', 'suggestion', 'confidence', 'exact', 'suggested_at', s.suggested_at,
                           'chars_added', s.chars_added, 'chars_removed', s.chars_removed));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- ---------- RLS ----------
alter table public.external_doc_suggestions enable row level security;
create policy external_doc_suggestions_select on public.external_doc_suggestions for select to authenticated
  using (public.can_view_team(team_id));
revoke all on public.external_doc_suggestions from anon;
revoke insert, update, delete on public.external_doc_suggestions from authenticated;

revoke execute on function
  public.resolve_google_member_by_name(uuid, text),
  public.record_external_suggestion(uuid, text, text, text, int, int, text, timestamptz),
  public.credit_pending_suggestions(uuid)
from public, anon, authenticated;
grant execute on function
  public.record_external_suggestion(uuid, text, text, text, int, int, text, timestamptz),
  public.credit_pending_suggestions(uuid)
to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.external_doc_suggestions;
  end if;
end
$$;
