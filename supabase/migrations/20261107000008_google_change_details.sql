-- =============================================================
-- 등잔(Lamp) — 8. 구글 문서 수정 내용 · 시각 상세
--
--  - external_doc_revisions.changes : 구간에서 바뀐 조각 (어디를) — 서버가 diff로 채움
--      [{op: insert|delete|replace, line, added?, removed?, before, after}]  최대 30개
--      line은 1부터 (문서는 문단, 시트는 행), 삭제는 이전 본문 기준
--  - external_doc_credits.edited_from / edited_to : 그 사람이 구간 안에서 편집한 시간대 (언제)
--      Drive Activity 기준. fallback(Activity 없음)이면 null
-- =============================================================

alter table public.external_doc_revisions
  add column changes           jsonb not null default '[]'::jsonb,
  add column changes_truncated int   not null default 0 check (changes_truncated >= 0);

alter table public.external_doc_credits
  add column edited_from timestamptz,
  add column edited_to   timestamptz;

-- 007과 같고, 편집 시간대 두 컬럼만 추가
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
      (revision_id, team_id, person_id, permission_id, display_name, chars_added, chars_removed,
       share, confidence, edited_from, edited_to)
    select r.id, r.team_id, x.person_id, x.permission_id, x.display_name,
           greatest(coalesce(x.chars_added, 0), 0), greatest(coalesce(x.chars_removed, 0), 0),
           least(greatest(coalesce(x.share, 0), 0), 1), x.confidence, x.edited_from, x.edited_to
    from jsonb_to_recordset(p_credits)
      as x(person_id text, permission_id text, display_name text,
           chars_added int, chars_removed int, share numeric, confidence text,
           edited_from timestamptz, edited_to timestamptz)
    returning id
  loop
    perform public.credit_external_credit(v_credit);
  end loop;

  update public.external_doc_revisions
     set author_id = (select author_id from public.external_doc_credits
                       where revision_id = r.id and author_id is not null
                       order by share desc, chars_added desc limit 1)
   where id = r.id;
end
$$;

-- 구간 기록 직후 바뀐 조각 저장 (서버 전용)
create or replace function public.set_revision_changes(p_revision_id uuid, p_changes jsonb, p_truncated int)
returns void language sql security definer set search_path = '' as $$
  update public.external_doc_revisions
     set changes = coalesce(p_changes, '[]'::jsonb),
         changes_truncated = greatest(coalesce(p_truncated, 0), 0)
   where id = p_revision_id
$$;

revoke execute on function
  public.replace_revision_credits(uuid, jsonb),
  public.set_revision_changes(uuid, jsonb, int)
from public, anon, authenticated;
grant execute on function public.set_revision_changes(uuid, jsonb, int) to service_role;
