-- AI 기여 분석: 팀 단위 보고서(JSON 전체)를 캐시한다 (docs/ANALYSIS_REPORT.md 5절)
--  scope = 'team'  → user_id 없음, payload = 출력 JSON 전체
--  scope = 'member'→ 기존처럼 팀원 1명당 1행 (summary · evidence)
--  쓰기는 서버(service_role)만. 읽기는 기존 정책(can_view_team) 그대로.
alter table public.ai_reports
  alter column user_id drop not null,
  add column scope    text not null default 'member' check (scope in ('team', 'member')),
  add column period   text not null default 'all' check (period in ('1m', '3m', 'all')),
  add column audience text not null default 'student' check (audience in ('student', 'professor')),
  add column payload  jsonb;

alter table public.ai_reports
  add constraint ai_reports_scope_user check ((scope = 'team') = (user_id is null));

create index ai_reports_team_scope_idx
  on public.ai_reports (team_id, scope, period, audience, created_at desc);

-- 교수용 보고서(면담 질문 포함)는 담당 교수만 읽는다
drop policy if exists ai_reports_select on public.ai_reports;
create policy ai_reports_select on public.ai_reports for select to authenticated
  using (
    public.can_view_team(team_id)
    and (
      audience = 'student'
      or exists (
        select 1 from public.teams t
        where t.id = team_id and public.is_course_professor(t.course_id)
      )
    )
  );
