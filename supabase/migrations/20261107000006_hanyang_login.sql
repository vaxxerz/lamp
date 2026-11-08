-- =============================================================
-- 등잔(Lamp) — 6. 한양대 구글 계정 전용 로그인
--
--  - 가입은 구글 로그인 + @hanyang.ac.kr 이메일만 허용 (DB 트리거에서 강제 → 우회 불가)
--    구글 로그인 화면의 hd=hanyang.ac.kr 은 힌트일 뿐이라 서버에서 다시 확인
--  - 교수 권한은 professor_emails 허용 목록에 있는 이메일만 (회원가입 메타데이터는 더 이상 신뢰 안 함)
--  - 예외: demo_accounts 에 등록된 데모 계정 (심사위원용 이메일/비밀번호 로그인)
--    demo_accounts 는 service_role / SQL Editor만 쓸 수 있어 사용자가 위조할 수 없음
--    (Supabase 대시보드에서 Email 가입도 꺼둘 것 — 데모 계정은 관리자 API로만 생성)
-- =============================================================

-- 교수 이메일 허용 목록 (SQL Editor 또는 service_role로만 관리)
create table public.professor_emails (
  email       text primary key check (email = lower(email)),
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.professor_emails enable row level security;  -- 정책 없음 = 클라이언트 접근 불가
revoke all on public.professor_emails from anon, authenticated;

-- 데모 계정 허용 목록 (scripts/seed-demo.mjs 가 계정 생성 직전에 등록)
create table public.demo_accounts (
  email       text primary key check (email = lower(email)),
  role        public.user_role not null default 'student',
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.demo_accounts enable row level security;
revoke all on public.demo_accounts from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_email    text    := lower(coalesce(new.email, ''));
  v_provider text    := coalesce(new.raw_app_meta_data ->> 'provider', '');
  v_demo     boolean;
  v_role     public.user_role;
begin
  select role into v_role from public.demo_accounts where email = v_email;
  v_demo := found;

  if not v_demo then
    if v_provider <> 'google' then
      raise exception 'hanyang_google_only: 한양대학교 구글 계정으로만 가입할 수 있습니다'
        using errcode = '42501';
    end if;
    if right(v_email, 14) <> '@hanyang.ac.kr' then
      raise exception 'hanyang_google_only: @hanyang.ac.kr 계정만 사용할 수 있습니다'
        using errcode = '42501';
    end if;
  end if;

  if v_demo then
    null;  -- demo_accounts 에 지정된 역할
  elsif exists (select 1 from public.professor_emails where email = v_email) then
    v_role := 'professor';
  else
    v_role := 'student';
  end if;

  insert into public.profiles (id, role, name, email, student_no, department)
  values (
    new.id,
    v_role,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
             nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
             split_part(v_email, '@', 1)),
    v_email,
    new.raw_user_meta_data ->> 'student_no',
    new.raw_user_meta_data ->> 'department'
  );
  return new;
end
$$;

-- 이미 학생으로 가입한 사람을 나중에 허용 목록에 추가하면 교수로 승격
create or replace function public.professor_emails_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set role = 'professor' where lower(email) = new.email;
  return null;
end
$$;

create trigger professor_emails_promote after insert on public.professor_emails
  for each row execute function public.professor_emails_after_insert();

revoke execute on function public.professor_emails_after_insert() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
