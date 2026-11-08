-- =============================================================
-- 등잔(Lamp) — 3. RLS · 권한 · Storage · Realtime
--   원칙: 학생은 자기 팀만, 교수는 자기 과목의 모든 팀을 "읽기 전용"으로.
--         기여 증거(revision, file_version, activity_event)는 클라이언트가 쓸 수 없음.
-- =============================================================

create or replace function public.meeting_team(p_meeting_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select team_id from public.meetings where id = p_meeting_id
$$;

-- ---------- RLS 활성화 ----------
alter table public.profiles           enable row level security;
alter table public.courses            enable row level security;
alter table public.course_members     enable row level security;
alter table public.teams              enable row level security;
alter table public.team_members       enable row level security;
alter table public.tasks              enable row level security;
alter table public.documents          enable row level security;
alter table public.document_revisions enable row level security;
alter table public.meetings           enable row level security;
alter table public.meeting_attendance enable row level security;
alter table public.meeting_comments   enable row level security;
alter table public.files              enable row level security;
alter table public.file_versions      enable row level security;
alter table public.activity_events    enable row level security;
alter table public.kudos              enable row level security;
alter table public.peer_reviews       enable row level security;
alter table public.ai_reports         enable row level security;

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_course(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- courses ----------
create policy courses_select on public.courses for select to authenticated
  using (professor_id = auth.uid() or public.is_course_member(id));
create policy courses_insert on public.courses for insert to authenticated
  with check (
    professor_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'professor')
  );
create policy courses_update on public.courses for update to authenticated
  using (professor_id = auth.uid()) with check (professor_id = auth.uid());
create policy courses_delete on public.courses for delete to authenticated
  using (professor_id = auth.uid());

-- ---------- course_members (참여는 join_course RPC) ----------
create policy course_members_select on public.course_members for select to authenticated
  using (public.is_course_member(course_id) or public.is_course_professor(course_id));
create policy course_members_delete on public.course_members for delete to authenticated
  using (public.is_course_professor(course_id));

-- ---------- teams (생성은 create_team RPC) ----------
create policy teams_select on public.teams for select to authenticated
  using (public.is_course_member(course_id) or public.is_course_professor(course_id));
create policy teams_update on public.teams for update to authenticated
  using (public.is_team_member(id) or public.is_course_professor(course_id))
  with check (public.is_team_member(id) or public.is_course_professor(course_id));
create policy teams_delete on public.teams for delete to authenticated
  using (public.is_course_professor(course_id));

-- ---------- team_members (참여는 join_team RPC) ----------
create policy team_members_select on public.team_members for select to authenticated
  using (public.is_course_member(course_id) or public.is_course_professor(course_id));
create policy team_members_delete on public.team_members for delete to authenticated
  using (user_id = auth.uid() or public.is_course_professor(course_id));

-- ---------- tasks ----------
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_view_team(team_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_team_member(team_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_team_member(team_id));

-- ---------- documents (내용 저장은 save_document RPC) ----------
create policy documents_select on public.documents for select to authenticated
  using (public.can_view_team(team_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.is_team_member(team_id) and kind = 'doc');
create policy documents_update on public.documents for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_team_member(team_id) and kind = 'doc');

create policy document_revisions_select on public.document_revisions for select to authenticated
  using (public.can_view_team(team_id));

-- ---------- meetings ----------
create policy meetings_select on public.meetings for select to authenticated
  using (public.can_view_team(team_id));
create policy meetings_insert on public.meetings for insert to authenticated
  with check (public.is_team_member(team_id));
create policy meetings_update on public.meetings for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));
create policy meetings_delete on public.meetings for delete to authenticated
  using (public.is_team_member(team_id));

-- 출결: 교수 포함 열람, 팀원만 체크/코멘트 (행 삭제 없음 — 기록 보존)
create policy meeting_attendance_select on public.meeting_attendance for select to authenticated
  using (public.can_view_team(team_id));
create policy meeting_attendance_insert on public.meeting_attendance for insert to authenticated
  with check (public.is_team_member(public.meeting_team(meeting_id)));
create policy meeting_attendance_update on public.meeting_attendance for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

-- 회의 코멘트: 팀원 작성, 작성자만 수정/삭제
create policy meeting_comments_select on public.meeting_comments for select to authenticated
  using (public.can_view_team(team_id));
create policy meeting_comments_insert on public.meeting_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_team_member(team_id));
create policy meeting_comments_update on public.meeting_comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy meeting_comments_delete on public.meeting_comments for delete to authenticated
  using (author_id = auth.uid());

-- ---------- 파일 (등록은 register_file_version RPC) ----------
create policy files_select on public.files for select to authenticated
  using (public.can_view_team(team_id));
create policy file_versions_select on public.file_versions for select to authenticated
  using (public.can_view_team(team_id));

-- ---------- 활동 이벤트 / AI 리포트 (읽기 전용) ----------
create policy activity_events_select on public.activity_events for select to authenticated
  using (public.can_view_team(team_id));
create policy ai_reports_select on public.ai_reports for select to authenticated
  using (public.can_view_team(team_id));

-- ---------- kudos ----------
create policy kudos_select on public.kudos for select to authenticated
  using (public.can_view_team(team_id));
create policy kudos_insert on public.kudos for insert to authenticated
  with check (giver_id = auth.uid() and public.is_team_member(team_id));
create policy kudos_delete on public.kudos for delete to authenticated
  using (giver_id = auth.uid());

-- ---------- peer_reviews: 평가자 본인 + 담당 교수만 열람 (피평가자는 못 봄) ----------
create policy peer_reviews_select on public.peer_reviews for select to authenticated
  using (
    reviewer_id = auth.uid()
    or exists (
      select 1 from public.teams t
      where t.id = team_id and public.is_course_professor(t.course_id)
    )
  );
create policy peer_reviews_insert on public.peer_reviews for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_team_member(team_id));
create policy peer_reviews_update on public.peer_reviews for update to authenticated
  using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid());

-- =============================================================
-- 테이블 · 컬럼 권한
-- =============================================================
revoke all on all tables in schema public from anon;

-- 컬럼 단위 UPDATE 제한 (나머지 컬럼은 트리거/RPC만 변경)
revoke update on public.profiles  from authenticated;
grant  update (name, student_no, department) on public.profiles to authenticated;

revoke update on public.courses   from authenticated;
grant  update (name, semester, weight_document, weight_task, weight_meeting, weight_file)
  on public.courses to authenticated;

revoke update on public.teams     from authenticated;
grant  update (name) on public.teams to authenticated;

revoke update on public.tasks     from authenticated;
grant  update (title, description, status, position, assignee_id, due_date, verified_by)
  on public.tasks to authenticated;

revoke update on public.documents from authenticated;
grant  update (title) on public.documents to authenticated;

revoke update on public.meetings  from authenticated;
grant  update (title, held_at, location) on public.meetings to authenticated;

revoke update on public.meeting_attendance from authenticated;
grant  update (status, comment) on public.meeting_attendance to authenticated;

revoke update on public.meeting_comments from authenticated;
grant  update (body) on public.meeting_comments to authenticated;

revoke update on public.peer_reviews from authenticated;
grant  update (score, comment) on public.peer_reviews to authenticated;

-- =============================================================
-- 함수 실행 권한
-- =============================================================
revoke execute on all functions in schema public from public, anon, authenticated;

-- RLS 정책이 호출하는 헬퍼
grant execute on function
  public.is_service_role(),
  public.is_team_member(uuid),
  public.is_course_professor(uuid),
  public.is_course_member(uuid),
  public.can_view_team(uuid),
  public.shares_course(uuid),
  public.meeting_team(uuid),
  public.try_uuid(text),
  public.compute_points(public.activity_type, numeric, jsonb)
to authenticated;

-- 클라이언트 RPC
grant execute on function
  public.join_course(text),
  public.create_team(uuid, text),
  public.join_team(uuid),
  public.get_team_contributions(uuid),
  public.get_team_attendance(uuid)
to authenticated;

-- 서버 전용 RPC (Next.js Route Handler가 service_role 키로 호출)
grant execute on function
  public.save_document(uuid, uuid, int, jsonb, text, int, int, int),
  public.register_file_version(uuid, uuid, text, text, text, bigint, text, int, int, jsonb),
  public.get_team_contributions(uuid),
  public.get_team_attendance(uuid)
to service_role;

-- =============================================================
-- Storage: team-files 버킷 (경로 규칙: {team_id}/{file_name}/{uuid})
--   업로드는 팀원이 직접(대용량 pptx 대비), 등록·분석은 서버 RPC.
--   증거 보존을 위해 수정/삭제 정책 없음.
-- =============================================================
insert into storage.buckets (id, name, public)
values ('team-files', 'team-files', false)
on conflict (id) do nothing;

create policy team_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'team-files'
    and public.can_view_team(public.try_uuid((storage.foldername(name))[1]))
  );
create policy team_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'team-files'
    and public.is_team_member(public.try_uuid((storage.foldername(name))[1]))
  );

-- =============================================================
-- Realtime: 칸반 · 문서 갱신 · 기여 피드 실시간 반영 (RLS 적용됨)
-- =============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.tasks, public.documents, public.activity_events,
      public.meeting_attendance, public.meeting_comments, public.kudos;
  end if;
end
$$;
