-- =============================================================
-- 등잔(Lamp) — 12. 회원가입: 학생 / 교수 선택
--
--  - 가입 경로는 그대로 한양대 구글 계정(@hanyang.ac.kr)만 (6번 handle_new_user 트리거)
--  - 가입 화면에서 "교수"를 고르면 교수 권한을 바로 주지 않고 **교수 신청**을 남긴다
--    · professor_emails 허용 목록에 있는 메일이면 가입 순간 이미 교수 (트리거)
--    · 아니면 학생 권한으로 시작하고, 관리자가 허용 목록에 넣으면 자동 승격 + 신청은 approved
--  - 사용자가 보내는 값은 학번 · 학과 · 신청 의사뿐. role 컬럼은 여전히 사용자가 바꿀 수 없다
-- =============================================================

create table public.professor_requests (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  email       text not null check (email = lower(email)),
  department  text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
alter table public.professor_requests enable row level security;
-- 본인 신청 상태만 읽기. 쓰기는 아래 함수 / 관리자(service_role)만
create policy professor_requests_select_own on public.professor_requests
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.professor_requests from anon, authenticated;

-- 가입 직후 1회 호출 (/auth/callback). 결과: 'student' | 'professor' | 'pending'
create or replace function public.complete_signup(
  p_role       text,
  p_student_no text default null,
  p_department text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role;
  v_mail text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_role not in ('student', 'professor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  update public.profiles
     set student_no = coalesce(nullif(trim(p_student_no), ''), student_no),
         department = coalesce(nullif(trim(p_department), ''), department)
   where id = v_uid
   returning role, email into v_role, v_mail;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0002';
  end if;

  if v_role = 'professor' then
    return 'professor';
  end if;
  if p_role = 'professor' then
    insert into public.professor_requests (user_id, email, department)
    values (v_uid, lower(coalesce(v_mail, '')), nullif(trim(p_department), ''))
    on conflict (user_id) do update
      set department = coalesce(excluded.department, public.professor_requests.department)
      where public.professor_requests.status = 'pending';
    return 'pending';
  end if;
  return 'student';
end
$$;
revoke execute on function public.complete_signup(text, text, text) from public, anon;
grant execute on function public.complete_signup(text, text, text) to authenticated;

-- 허용 목록에 추가되면 승격 + 신청 승인 처리 (6번 함수 확장)
create or replace function public.professor_emails_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set role = 'professor' where lower(email) = new.email;
  update public.professor_requests
     set status = 'approved', decided_at = now()
   where email = new.email and status = 'pending';
  return null;
end
$$;
revoke execute on function public.professor_emails_after_insert() from public, anon, authenticated;
