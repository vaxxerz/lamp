-- =============================================================
-- 등잔(Lamp) — 15. 프로필 이름 정리
--
--  한양 구글 계정 이름은 "­최완규 | 정보시스템학과 | 한양대(서울)" 처럼
--  보이지 않는 문자(soft hyphen 등)와 소속이 붙어 와서 화면마다 길게 보였다.
--  → 저장할 때 보이지 않는 문자를 지우고 " | " 앞부분(이름)만 남긴다.
--    정리하고 나서 비면 원래 값을 그대로 둔다.
-- =============================================================

create or replace function public.clean_person_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(trim(regexp_replace(
      split_part(regexp_replace(p_name, '[­​-‏⁠﻿]', '', 'g'), '|', 1),
      '\s+', ' ', 'g')), ''),
    p_name)
$$;

create or replace function public.profiles_clean_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := public.clean_person_name(new.name);
  return new;
end
$$;

drop trigger if exists profiles_clean_name on public.profiles;
create trigger profiles_clean_name
  before insert or update of name on public.profiles
  for each row execute function public.profiles_clean_name();

-- 기존 프로필
update public.profiles
   set name = public.clean_person_name(name)
 where name is distinct from public.clean_person_name(name);
