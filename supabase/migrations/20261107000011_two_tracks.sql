-- =============================================================
-- 등잔(Lamp) — 11. 투트랙: 독립 팀플(교수 없음) + 과목 팀플(교수 포함)
--
--  1트랙 독립 팀플: 과목 코드 없이 학생끼리 팀을 만들고 "팀 초대코드"로 합류. 교수 열람 없음.
--    → 팀마다 교수 없는 "독립 과목"(kind = 'independent')을 하나 만들어 그 아래에 둔다.
--      팀 · 보드 · 문서 · 구글 · 회의 · 파일 · 점수 · 권한 규칙을 그대로 재사용하기 위해서.
--      professor_id가 null이라 교수 권한(is_course_professor)은 생기지 않는다.
--  2트랙 과목 팀플: 지금처럼 교수가 과목 개설 → 과목 코드 → 팀 만들기 · 참여 (kind = 'class').
-- =============================================================

alter table public.courses
  add column kind text not null default 'class' check (kind in ('class', 'independent'));
alter table public.courses alter column professor_id drop not null;
-- 수업 과목은 교수가 반드시 있고, 독립 팀플은 교수가 없다
alter table public.courses
  add constraint courses_kind_professor check ((kind = 'class') = (professor_id is not null));

-- 독립 팀플 합류용 (수업 과목의 팀은 null — 과목 코드로 참여)
alter table public.teams add column invite_code text unique;

-- ---------- 1트랙: 독립 팀 만들기 ----------
create or replace function public.create_independent_team(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_course uuid;
  v_team uuid;
  v_code text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select role from public.profiles where id = v_uid) <> 'student' then
    raise exception '학생 계정만 팀을 만들 수 있습니다' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception '팀 이름을 입력해 주세요' using errcode = '22023';
  end if;

  insert into public.courses (kind, professor_id, name, semester)
  values ('independent', null, v_name, to_char(now() at time zone 'Asia/Seoul', 'YYYY'))
  returning id into v_course;
  insert into public.course_members (course_id, user_id) values (v_course, v_uid);

  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    begin
      insert into public.teams (course_id, name, invite_code) values (v_course, v_name, v_code)
      returning id into v_team;
      exit;
    exception when unique_violation then
      -- 초대코드 충돌 시 다시 생성
    end;
  end loop;
  insert into public.team_members (team_id, course_id, user_id) values (v_team, v_course, v_uid);

  return jsonb_build_object('team_id', v_team, 'invite_code', v_code);
end
$$;

-- ---------- 1트랙: 팀 초대코드로 합류 ----------
create or replace function public.join_team_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t public.teams%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select role from public.profiles where id = v_uid) <> 'student' then
    raise exception '학생 계정만 팀에 참여할 수 있습니다' using errcode = '42501';
  end if;
  select tm.* into t
  from public.teams tm join public.courses c on c.id = tm.course_id
  where tm.invite_code = upper(trim(coalesce(p_code, ''))) and c.kind = 'independent';
  if not found then
    raise exception '잘못된 팀 초대코드입니다' using errcode = 'P0002';
  end if;

  insert into public.course_members (course_id, user_id) values (t.course_id, v_uid)
  on conflict do nothing;
  begin
    insert into public.team_members (team_id, course_id, user_id) values (t.id, t.course_id, v_uid);
  exception when unique_violation then
    raise exception '이미 이 팀에 속해 있습니다' using errcode = '23505';
  end;
  return t.id;
end
$$;

-- ---------- 2트랙 기존 RPC: 독립 팀플에는 쓰지 않도록 ----------
-- 과목 코드로는 수업 과목만 참여 (독립 과목의 내부 코드로 들어오는 것 방지)
create or replace function public.join_course(p_invite_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_course uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select role from public.profiles where id = v_uid) <> 'student' then
    raise exception '학생 계정만 과목에 참여할 수 있습니다' using errcode = '42501';
  end if;
  select id into v_course from public.courses
  where invite_code = upper(trim(p_invite_code)) and kind = 'class';
  if v_course is null then
    raise exception '잘못된 초대 코드입니다' using errcode = 'P0002';
  end if;
  insert into public.course_members (course_id, user_id) values (v_course, v_uid)
  on conflict do nothing;
  return v_course;
end
$$;

-- 수업 과목 안에서만 팀 생성 (독립 팀플은 팀 하나 = 과목 하나)
create or replace function public.create_team(p_course_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_team uuid;
  v_is_prof boolean := public.is_course_professor(p_course_id);
begin
  if (select kind from public.courses where id = p_course_id) is distinct from 'class' then
    raise exception '독립 팀플에는 팀을 더 만들 수 없습니다' using errcode = '42501';
  end if;
  if v_uid is null or not (v_is_prof or public.is_course_member(p_course_id)) then
    raise exception '과목 구성원만 팀을 만들 수 있습니다' using errcode = '42501';
  end if;
  if not v_is_prof and exists (
    select 1 from public.team_members where course_id = p_course_id and user_id = v_uid
  ) then
    raise exception '이미 이 과목의 팀에 속해 있습니다' using errcode = '23505';
  end if;
  insert into public.teams (course_id, name) values (p_course_id, trim(p_name))
  returning id into v_team;
  if not v_is_prof then
    insert into public.team_members (team_id, course_id, user_id)
    values (v_team, p_course_id, v_uid);
  end if;
  return v_team;
end
$$;

-- ---------- 권한 ----------
revoke execute on function
  public.create_independent_team(text),
  public.join_team_by_code(text)
from public, anon;
grant execute on function
  public.create_independent_team(text),
  public.join_team_by_code(text),
  public.join_course(text),
  public.create_team(uuid, text)
to authenticated;
