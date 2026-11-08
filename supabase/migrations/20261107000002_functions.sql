-- =============================================================
-- 등잔(Lamp) — 2. 함수 · 트리거 · RPC · 기여도 산정
-- =============================================================

-- -------------------------------------------------------------
-- 2-1. 권한 헬퍼 (RLS 정책에서 사용, RLS 재귀 방지를 위해 security definer)
-- -------------------------------------------------------------
create or replace function public.is_service_role()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
         = 'service_role'
$$;

create or replace function public.is_team_member(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  )
$$;

create or replace function public.is_course_professor(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.courses
    where id = p_course_id and professor_id = auth.uid()
  )
$$;

create or replace function public.is_course_member(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_members
    where course_id = p_course_id and user_id = auth.uid()
  )
$$;

-- 팀원 또는 해당 과목 담당 교수
create or replace function public.can_view_team(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_team_member(p_team_id)
      or exists (
        select 1 from public.teams t
        join public.courses c on c.id = t.course_id
        where t.id = p_team_id and c.professor_id = auth.uid()
      )
$$;

-- 같은 과목에 속한 사람(수강생끼리, 교수-수강생)끼리만 프로필 열람
create or replace function public.shares_course(p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_other = auth.uid()
      or exists (
        select 1 from public.course_members a
        join public.course_members b on b.course_id = a.course_id
        where a.user_id = auth.uid() and b.user_id = p_other
      )
      or exists (
        select 1 from public.courses c
        join public.course_members m on m.course_id = c.id
        where (c.professor_id = auth.uid() and m.user_id = p_other)
           or (c.professor_id = p_other and m.user_id = auth.uid())
      )
$$;

create or replace function public.try_uuid(p_text text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end
$$;

-- -------------------------------------------------------------
-- 2-2. 공통 트리거
-- -------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger files_touch before update on public.files
  for each row execute function public.touch_updated_at();
create trigger peer_reviews_touch before update on public.peer_reviews
  for each row execute function public.touch_updated_at();

-- 회원가입 시 프로필 자동 생성 (signUp options.data: {name, role, student_no, department})
-- ⚠️ 해커톤 MVP: role=professor 를 메타데이터로 신뢰함. 실서비스에선 교수 인증 절차 필요.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, name, email, student_no, department)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'professor'
         then 'professor'::public.user_role else 'student'::public.user_role end,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'student_no',
    new.raw_user_meta_data ->> 'department'
  );
  return new;
end
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- 2-3. 점수 산정 & 이벤트 기록
-- -------------------------------------------------------------
-- 활동 1건의 점수. 한 건당 상한을 둬서 대량 스팸의 효과를 제한.
create or replace function public.compute_points(
  p_type public.activity_type, p_amount numeric, p_meta jsonb
) returns numeric language sql immutable set search_path = '' as $$
  select round(case p_type
    -- 유효 글자 100자당 1점, 1건당 최대 30점
    when 'doc_edit'       then least(p_amount, 3000) / 100.0
    when 'meeting_note'   then least(p_amount, 3000) / 100.0
    when 'task_create'    then 0.5
    -- 다른 팀원이 완료를 확인해야 온전한 점수
    when 'task_complete'  then case when coalesce((p_meta ->> 'verified')::boolean, false)
                                    then 3 else 1.5 end
    when 'meeting_attend' then case when p_meta ->> 'status' = 'late' then 0.5 else 1 end
    -- 첫 업로드 또는 실제 변경이 있을 때만 기본 2점 (같은 파일 재업로드 방지)
    when 'file_version'   then
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

create or replace function public.activity_events_set_points()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.points := public.compute_points(new.type, new.amount, new.meta);
  return new;
end
$$;

create trigger activity_events_points before insert or update on public.activity_events
  for each row execute function public.activity_events_set_points();

-- 내부용: (type, ref_id, user_id) 단위로 upsert
create or replace function public.record_event(
  p_team_id uuid, p_user_id uuid,
  p_category public.activity_category, p_type public.activity_type,
  p_amount numeric, p_ref_table text, p_ref_id uuid,
  p_meta jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.activity_events
    (team_id, user_id, category, type, amount, ref_table, ref_id, meta)
  values
    (p_team_id, p_user_id, p_category, p_type, p_amount, p_ref_table, p_ref_id, coalesce(p_meta, '{}'::jsonb))
  on conflict (type, ref_id, user_id) do update
    set amount = excluded.amount,
        meta   = public.activity_events.meta || excluded.meta
  returning id into v_id;
  return v_id;
end
$$;

-- -------------------------------------------------------------
-- 2-4. 태스크: 완료/확인 규칙 + 이벤트
-- -------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.assignee_id is not null and not exists (
    select 1 from public.team_members where team_id = new.team_id and user_id = new.assignee_id
  ) then
    raise exception '담당자는 팀원이어야 합니다' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.created_by   := coalesce(v_uid, new.created_by);
    new.verified_by  := null;
    new.verified_at  := null;
    if new.status = 'done' then
      new.completed_by := coalesce(new.assignee_id, new.created_by);
      new.completed_at := now();
    else
      new.completed_by := null;
      new.completed_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.team_id <> old.team_id then
    raise exception 'team_id는 변경할 수 없습니다' using errcode = '22023';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.status = 'done' and old.status <> 'done' then
    -- 완료 처리: 담당자가 있으면 담당자, 없으면 완료 누른 사람의 기여
    new.completed_by := coalesce(new.assignee_id, v_uid, old.created_by);
    new.completed_at := now();
    new.verified_by  := null;
    new.verified_at  := null;
  elsif new.status <> 'done' then
    new.completed_by := null;
    new.completed_at := null;
    new.verified_by  := null;
    new.verified_at  := null;
  else
    -- done 유지: 완료자 고정, 확인(verify)만 변경 가능
    new.completed_by := old.completed_by;
    new.completed_at := old.completed_at;
    if new.verified_by is distinct from old.verified_by then
      if new.verified_by is null then
        if v_uid is not null and v_uid <> old.verified_by then
          raise exception '확인 취소는 확인한 본인만 가능합니다' using errcode = '42501';
        end if;
        new.verified_at := null;
      else
        if v_uid is not null and new.verified_by <> v_uid then
          raise exception '본인 명의로만 확인할 수 있습니다' using errcode = '42501';
        end if;
        if new.verified_by = new.completed_by then
          raise exception '완료한 본인은 확인할 수 없습니다' using errcode = '42501';
        end if;
        if not exists (
          select 1 from public.team_members where team_id = new.team_id and user_id = new.verified_by
        ) then
          raise exception '팀원만 확인할 수 있습니다' using errcode = '42501';
        end if;
        new.verified_at := now();
      end if;
    else
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end
$$;

create or replace function public.tasks_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_event(new.team_id, new.created_by, 'task', 'task_create', 1,
      'tasks', new.id, jsonb_build_object('title', new.title));
  elsif old.completed_by is not null and new.completed_by is distinct from old.completed_by then
    delete from public.activity_events
    where type = 'task_complete' and ref_id = old.id and user_id = old.completed_by;
  end if;

  if new.completed_by is not null then
    perform public.record_event(new.team_id, new.completed_by, 'task', 'task_complete', 1,
      'tasks', new.id,
      jsonb_build_object('title', new.title,
                         'verified', new.verified_by is not null,
                         'verified_by', new.verified_by));
  end if;
  return null;
end
$$;

create trigger tasks_before before insert or update on public.tasks
  for each row execute function public.tasks_before_write();
create trigger tasks_after after insert or update on public.tasks
  for each row execute function public.tasks_after_write();

-- -------------------------------------------------------------
-- 2-5. 문서: 클라이언트 생성 시 빈 문서로 초기화 (내용은 save_document로만)
-- -------------------------------------------------------------
create or replace function public.documents_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version      := 1;
  new.content      := '{"type":"doc","content":[]}'::jsonb;
  new.content_text := '';
  new.created_by   := coalesce(auth.uid(), new.created_by);
  new.updated_by   := null;
  return new;
end
$$;

create trigger documents_before_insert before insert on public.documents
  for each row execute function public.documents_before_insert();

create trigger documents_touch before update of title on public.documents
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- 2-6. 회의: 회의록 문서 자동 생성 / 출결 · 코멘트
-- -------------------------------------------------------------
create or replace function public.meetings_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_doc uuid;
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  insert into public.documents (team_id, kind, title, created_by)
  values (new.team_id, 'meeting_note', '회의록 · ' || new.title, new.created_by)
  returning id into v_doc;
  new.document_id := v_doc;
  return new;
end
$$;

-- 회의가 만들어지면 현재 팀원 전원의 출결 행을 'unchecked'로 생성
create or replace function public.meetings_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.meeting_attendance (meeting_id, user_id, team_id)
  select new.id, tm.user_id, new.team_id
  from public.team_members tm where tm.team_id = new.team_id;
  return null;
end
$$;

create trigger meetings_before_insert before insert on public.meetings
  for each row execute function public.meetings_before_insert();
create trigger meetings_after_insert after insert on public.meetings
  for each row execute function public.meetings_after_insert();

create or replace function public.meeting_attendance_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    -- 회의 이후 합류한 팀원 등 수동 추가
    select team_id into new.team_id from public.meetings where id = new.meeting_id;
    if not exists (
      select 1 from public.team_members where team_id = new.team_id and user_id = new.user_id
    ) then
      raise exception '출결 대상은 팀원이어야 합니다' using errcode = '22023';
    end if;
    if new.status <> 'unchecked' then
      if v_uid is not null and v_uid = new.user_id then
        raise exception '본인 출결은 다른 팀원이 체크합니다' using errcode = '42501';
      end if;
      new.checked_by := v_uid;
      new.checked_at := now();
    else
      new.checked_by := null;
      new.checked_at := null;
    end if;
    new.comment_by := case when new.comment is not null then v_uid end;
    return new;
  end if;

  -- UPDATE: 키·작성자 정보는 고정, status/comment만 변경
  new.meeting_id := old.meeting_id;
  new.user_id    := old.user_id;
  new.team_id    := old.team_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.status is distinct from old.status then
    if v_uid is not null and v_uid = new.user_id then
      raise exception '본인 출결은 다른 팀원이 체크합니다' using errcode = '42501';
    end if;
    new.checked_by := case when new.status = 'unchecked' then null else v_uid end;
    new.checked_at := case when new.status = 'unchecked' then null else now() end;
  else
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  if new.comment is distinct from old.comment then
    new.comment    := nullif(trim(new.comment), '');
    new.comment_by := case when new.comment is not null then v_uid end;
  else
    new.comment_by := old.comment_by;
  end if;
  return new;
end
$$;

-- 출석 1점, 지각 0.5점 / 결석·사유·미체크는 이벤트 없음
create or replace function public.meeting_attendance_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings%rowtype;
begin
  if new.status in ('present', 'late') then
    select * into m from public.meetings where id = new.meeting_id;
    perform public.record_event(new.team_id, new.user_id, 'meeting', 'meeting_attend', 1,
      'meetings', m.id,
      jsonb_build_object('title', m.title, 'held_at', m.held_at, 'status', new.status));
  else
    delete from public.activity_events
    where type = 'meeting_attend' and ref_id = new.meeting_id and user_id = new.user_id;
  end if;
  return null;
end
$$;

create trigger meeting_attendance_before before insert or update on public.meeting_attendance
  for each row execute function public.meeting_attendance_before_write();
create trigger meeting_attendance_after after insert or update on public.meeting_attendance
  for each row execute function public.meeting_attendance_after();

create or replace function public.meeting_comments_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    select team_id into new.team_id from public.meetings where id = new.meeting_id;
    if new.team_id is null then
      raise exception '회의를 찾을 수 없습니다' using errcode = 'P0002';
    end if;
    return new;
  end if;
  new.meeting_id := old.meeting_id;
  new.team_id    := old.team_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end
$$;

create trigger meeting_comments_before before insert or update on public.meeting_comments
  for each row execute function public.meeting_comments_before_write();

-- 팀원별 출결 요약 (교수 대시보드)
--   출석률 = (출석 + 지각×0.5) / (전체 회의 − 사유 불참 − 미체크)
create or replace function public.get_team_attendance(p_team_id uuid)
returns table (
  user_id          uuid,
  name             text,
  meetings_total   bigint,
  present          bigint,
  late             bigint,
  absent           bigint,
  excused          bigint,
  unchecked        bigint,
  attendance_rate  numeric
) language sql stable security definer set search_path = '' as $$
  select tm.user_id, p.name,
         count(a.meeting_id),
         count(*) filter (where a.status = 'present'),
         count(*) filter (where a.status = 'late'),
         count(*) filter (where a.status = 'absent'),
         count(*) filter (where a.status = 'excused'),
         count(*) filter (where a.status = 'unchecked'),
         round(100.0 * (count(*) filter (where a.status = 'present')
                      + 0.5 * count(*) filter (where a.status = 'late'))
               / nullif(count(*) filter (where a.status in ('present', 'late', 'absent')), 0), 1)
  from public.team_members tm
  join public.profiles p on p.id = tm.user_id
  left join public.meeting_attendance a on a.team_id = tm.team_id and a.user_id = tm.user_id
  where tm.team_id = p_team_id
    and (public.can_view_team(p_team_id) or public.is_service_role())
  group by tm.user_id, p.name
  order by p.name
$$;

-- -------------------------------------------------------------
-- 2-7. 팀원 인정(kudos) / 상호평가 검증
-- -------------------------------------------------------------
create or replace function public.kudos_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  e public.activity_events%rowtype;
begin
  new.giver_id := coalesce(auth.uid(), new.giver_id);
  select * into e from public.activity_events where id = new.event_id;
  if not found then
    raise exception '활동을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if e.user_id = new.giver_id then
    raise exception '본인 활동은 인정할 수 없습니다' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.team_members where team_id = e.team_id and user_id = new.giver_id
  ) then
    raise exception '같은 팀원만 인정할 수 있습니다' using errcode = '42501';
  end if;
  new.team_id := e.team_id;
  return new;
end
$$;

create trigger kudos_before_insert before insert on public.kudos
  for each row execute function public.kudos_before_insert();

create or replace function public.peer_reviews_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.team_id     := old.team_id;
    new.reviewer_id := old.reviewer_id;
    new.reviewee_id := old.reviewee_id;
    return new;
  end if;
  new.reviewer_id := coalesce(auth.uid(), new.reviewer_id);
  if (select count(*) from public.team_members
      where team_id = new.team_id and user_id in (new.reviewer_id, new.reviewee_id)) <> 2 then
    raise exception '같은 팀원끼리만 평가할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger peer_reviews_before before insert or update on public.peer_reviews
  for each row execute function public.peer_reviews_before_write();

-- -------------------------------------------------------------
-- 2-8. RPC (클라이언트용): 과목 참여 / 팀 생성 · 참여
-- -------------------------------------------------------------
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
  select id into v_course from public.courses where invite_code = upper(trim(p_invite_code));
  if v_course is null then
    raise exception '잘못된 초대 코드입니다' using errcode = 'P0002';
  end if;
  insert into public.course_members (course_id, user_id) values (v_course, v_uid)
  on conflict do nothing;
  return v_course;
end
$$;

-- 교수: 빈 팀 생성 / 학생(수강생): 팀 생성 후 본인 자동 참여
create or replace function public.create_team(p_course_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_team uuid;
  v_is_prof boolean := public.is_course_professor(p_course_id);
begin
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

create or replace function public.join_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_course uuid;
begin
  select course_id into v_course from public.teams where id = p_team_id;
  if v_course is null then
    raise exception '팀을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if v_uid is null or not public.is_course_member(v_course) then
    raise exception '과목 수강생만 팀에 참여할 수 있습니다' using errcode = '42501';
  end if;
  insert into public.team_members (team_id, course_id, user_id)
  values (p_team_id, v_course, v_uid);
exception when unique_violation then
  raise exception '이미 이 과목의 팀에 속해 있습니다' using errcode = '23505';
end
$$;

-- -------------------------------------------------------------
-- 2-9. RPC (서버 전용, service_role): 문서 저장 / 파일 버전 등록
--   글자 수 diff·파일 텍스트 추출은 Next.js 서버에서 계산해 넘김 (클라 위조 방지)
-- -------------------------------------------------------------
create or replace function public.save_document(
  p_document_id   uuid,
  p_author_id     uuid,
  p_base_version  int,
  p_content       jsonb,
  p_content_text  text,
  p_chars_added   int,
  p_chars_removed int,
  p_pasted_chars  int default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d          public.documents%rowtype;
  r          public.document_revisions%rowtype;
  v_version  int;
  v_category public.activity_category;
  v_type     public.activity_type;
  v_eff      numeric;
begin
  select * into d from public.documents where id = p_document_id for update;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members where team_id = d.team_id and user_id = p_author_id
  ) then
    raise exception 'not_team_member' using errcode = '42501';
  end if;
  if d.version <> p_base_version then
    -- 다른 팀원이 먼저 저장함 → 클라이언트는 새로고침 안내
    raise exception 'version_conflict' using errcode = '40001', detail = d.version::text;
  end if;

  v_version := d.version + 1;
  update public.documents
     set content = p_content, content_text = p_content_text,
         version = v_version, updated_by = p_author_id, updated_at = now()
   where id = d.id;

  if d.kind = 'meeting_note' then
    v_category := 'meeting'; v_type := 'meeting_note';
  else
    v_category := 'document'; v_type := 'doc_edit';
  end if;

  -- 같은 작성자가 1분 안에 다시 저장하면 직전 revision에 병합
  select * into r from public.document_revisions
   where document_id = d.id order by created_at desc, version desc limit 1;
  if found and r.author_id = p_author_id and r.created_at > now() - interval '60 seconds' then
    update public.document_revisions
       set version       = v_version,
           content       = p_content,
           content_text  = p_content_text,
           chars_added   = chars_added   + greatest(p_chars_added, 0),
           chars_removed = chars_removed + greatest(p_chars_removed, 0),
           pasted_chars  = pasted_chars  + greatest(p_pasted_chars, 0),
           updated_at    = now()
     where id = r.id
    returning * into r;
  else
    insert into public.document_revisions
      (document_id, team_id, author_id, version, content, content_text,
       chars_added, chars_removed, pasted_chars)
    values
      (d.id, d.team_id, p_author_id, v_version, p_content, p_content_text,
       greatest(p_chars_added, 0), greatest(p_chars_removed, 0), greatest(p_pasted_chars, 0))
    returning * into r;
  end if;

  -- 유효 글자 = 직접 입력 + 붙여넣기 30% + 삭제 50%
  v_eff := greatest(r.chars_added - r.pasted_chars, 0)
         + 0.3 * least(r.pasted_chars, r.chars_added)
         + 0.5 * r.chars_removed;
  if v_eff > 0 then
    perform public.record_event(d.team_id, p_author_id, v_category, v_type, round(v_eff),
      'document_revisions', r.id,
      jsonb_build_object('document_id', d.id, 'document_title', d.title,
                         'chars_added', r.chars_added, 'chars_removed', r.chars_removed,
                         'pasted_chars', r.pasted_chars));
  end if;

  return jsonb_build_object('version', v_version, 'revision_id', r.id);
end
$$;

create or replace function public.register_file_version(
  p_team_id        uuid,
  p_uploader_id    uuid,
  p_file_name      text,
  p_storage_path   text,
  p_mime_type      text,
  p_size_bytes     bigint,
  p_extracted_text text,
  p_chars_added    int,
  p_chars_removed  int,
  p_change_summary jsonb default '{}'::jsonb   -- 예: {"slides_changed":[3,5],"slides_added":[9]}
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f         public.files%rowtype;
  v_version int;
  v_ver_id  uuid;
  v_first   boolean;
  v_added   int := greatest(coalesce(p_chars_added, 0), 0);
  v_removed int := greatest(coalesce(p_chars_removed, 0), 0);
begin
  if not exists (
    select 1 from public.team_members where team_id = p_team_id and user_id = p_uploader_id
  ) then
    raise exception 'not_team_member' using errcode = '42501';
  end if;

  insert into public.files (team_id, name, extension, created_by)
  values (p_team_id, p_file_name,
          lower(nullif(substring(p_file_name from '\.([^.]+)$'), '')), p_uploader_id)
  on conflict (team_id, name) do nothing;

  select * into f from public.files
   where team_id = p_team_id and name = p_file_name for update;
  v_version := f.latest_version + 1;
  v_first   := v_version = 1;

  update public.files set latest_version = v_version where id = f.id;

  insert into public.file_versions
    (file_id, team_id, version, uploader_id, storage_path, mime_type, size_bytes,
     extracted_text, chars_added, chars_removed, change_summary)
  values
    (f.id, p_team_id, v_version, p_uploader_id, p_storage_path, p_mime_type, p_size_bytes,
     p_extracted_text, v_added, v_removed, coalesce(p_change_summary, '{}'::jsonb))
  returning id into v_ver_id;

  perform public.record_event(p_team_id, p_uploader_id, 'file', 'file_version',
    round(v_added + 0.5 * v_removed),
    'file_versions', v_ver_id,
    coalesce(p_change_summary, '{}'::jsonb) || jsonb_build_object(
      'file_id', f.id, 'file_name', f.name, 'version', v_version, 'first', v_first,
      'chars_added', v_added, 'chars_removed', v_removed));

  return jsonb_build_object('file_id', f.id, 'version', v_version, 'file_version_id', v_ver_id);
end
$$;

-- -------------------------------------------------------------
-- 2-10. 기여도 산정 (교수 대시보드 / 학생 "내 기여")
--   카테고리 점수 = ln(1 + Σ 활동 점수 × kudos 보너스 1.2)   ← 수확체감
--   share        = Σ 가중치 × (팀 내 카테고리 비율) / 활동이 있는 카테고리 가중치 합
--   mismatch     = |활동 기여 비율 − 상호평가 비율| ≥ 15%p
-- -------------------------------------------------------------
create or replace function public.get_team_contributions(p_team_id uuid)
returns table (
  user_id         uuid,
  name            text,
  document_score  numeric,
  task_score      numeric,
  meeting_score   numeric,
  file_score      numeric,
  raw_points      numeric,
  share_pct       numeric,
  peer_avg        numeric,
  peer_share_pct  numeric,
  mismatch        boolean,
  event_count     bigint,
  kudos_received  bigint
) language sql stable security definer set search_path = '' as $$
  with authorized as (
    select (public.can_view_team(p_team_id) or public.is_service_role()) as ok
  ),
  members as (
    select tm.user_id, p.name
    from public.team_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.team_id = p_team_id and (select ok from authorized)
  ),
  w as (
    select c.weight_document, c.weight_task, c.weight_meeting, c.weight_file
    from public.teams t join public.courses c on c.id = t.course_id
    where t.id = p_team_id
  ),
  ev as (
    select e.user_id, e.category,
           e.points * case when k.cnt > 0 then 1.2 else 1 end as pts,
           coalesce(k.cnt, 0) as kc
    from public.activity_events e
    left join lateral (
      select count(*) as cnt from public.kudos where event_id = e.id
    ) k on true
    where e.team_id = p_team_id
  ),
  per as (
    select m.user_id, m.name,
      ln(1 + coalesce(sum(ev.pts) filter (where ev.category = 'document'), 0)) as s_doc,
      ln(1 + coalesce(sum(ev.pts) filter (where ev.category = 'task'),     0)) as s_task,
      ln(1 + coalesce(sum(ev.pts) filter (where ev.category = 'meeting'),  0)) as s_meet,
      ln(1 + coalesce(sum(ev.pts) filter (where ev.category = 'file'),     0)) as s_file,
      coalesce(sum(ev.pts), 0)  as raw,
      count(ev.user_id)         as n,
      coalesce(sum(ev.kc), 0)   as kc
    from members m
    left join ev on ev.user_id = m.user_id
    group by m.user_id, m.name
  ),
  tot as (
    select sum(s_doc) as td, sum(s_task) as tt, sum(s_meet) as tm, sum(s_file) as tf from per
  ),
  scored as (
    select per.*,
      ( w.weight_document * coalesce(per.s_doc  / nullif(tot.td, 0), 0)
      + w.weight_task     * coalesce(per.s_task / nullif(tot.tt, 0), 0)
      + w.weight_meeting  * coalesce(per.s_meet / nullif(tot.tm, 0), 0)
      + w.weight_file     * coalesce(per.s_file / nullif(tot.tf, 0), 0)
      ) / nullif(
          case when tot.td > 0 then w.weight_document else 0 end
        + case when tot.tt > 0 then w.weight_task     else 0 end
        + case when tot.tm > 0 then w.weight_meeting  else 0 end
        + case when tot.tf > 0 then w.weight_file     else 0 end, 0) as share
    from per cross join tot cross join w
  ),
  peer as (
    select pr.reviewee_id, avg(pr.score)::numeric as avg_score
    from public.peer_reviews pr
    where pr.team_id = p_team_id
    group by pr.reviewee_id
  ),
  peer_tot as (
    select sum(avg_score) as s from peer
  )
  select s.user_id, s.name,
         round(s.s_doc, 3), round(s.s_task, 3), round(s.s_meet, 3), round(s.s_file, 3),
         round(s.raw, 2),
         round(coalesce(s.share, 0) * 100, 1),
         round(pe.avg_score, 2),
         round(pe.avg_score / nullif(pt.s, 0) * 100, 1),
         coalesce(abs(coalesce(s.share, 0) - pe.avg_score / nullif(pt.s, 0)) >= 0.15, false),
         s.n, s.kc
  from scored s
  left join peer pe on pe.reviewee_id = s.user_id
  cross join peer_tot pt
  order by coalesce(s.share, 0) desc, s.name
$$;
