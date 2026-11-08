-- =============================================================
-- 등잔(Lamp) — 14. 구글 문서 제안 작성자 이름 매칭 완화
--
--  docx 제안 작성자 이름은 "최완규" 처럼 짧게 오는데,
--  구글 계정 표시 이름은 "­최완규 | 정보시스템학과 | 한양대(서울)" 처럼
--  보이지 않는 문자(soft hyphen 등)와 소속이 붙어 있어 정확히 같은지 비교하면 매칭이 안 됐다.
--  → 양쪽을 정규화(보이지 않는 문자 제거, " | " 앞부분만, 공백 정리)해서 비교하고
--    Lamp 프로필 이름도 후보로 본다. 팀 안에서 한 명으로 좁혀질 때만 매칭.
--  이후 이미 연결된 팀원들의 미매칭 제안을 소급 반영한다.
-- =============================================================

create or replace function public.google_name_key(p_name text)
returns text language sql immutable set search_path = '' as $$
  select nullif(
    lower(trim(regexp_replace(
      split_part(regexp_replace(p_name, '[­​-‏⁠﻿]', '', 'g'), '|', 1),
      '\s+', ' ', 'g'))),
    '')
$$;

create or replace function public.resolve_google_member_by_name(p_team_id uuid, p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select (array_agg(distinct ga.user_id))[1]
  from public.google_accounts ga
  join public.team_members tm on tm.user_id = ga.user_id and tm.team_id = p_team_id
  join public.profiles p on p.id = ga.user_id
  where public.google_name_key(p_name) is not null
    and public.google_name_key(p_name) in (public.google_name_key(ga.display_name), public.google_name_key(p.name))
  having count(distinct ga.user_id) = 1
$$;

-- 소급: 이미 구글 연결한 사람들의 미매칭 제안
do $$
declare
  u uuid;
begin
  for u in select user_id from public.google_accounts loop
    perform public.credit_pending_suggestions(u);
  end loop;
end
$$;
