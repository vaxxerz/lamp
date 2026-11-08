-- =============================================================
-- 등잔(Lamp) — 1. 스키마 (테이블 · enum · 인덱스)
-- 대상: Supabase (Postgres 15+)
-- =============================================================

-- ---------- enum ----------
create type public.user_role as enum ('student', 'professor');
create type public.task_status as enum ('todo', 'doing', 'done');
create type public.document_kind as enum ('doc', 'meeting_note');
create type public.attendance_status as enum (
  'unchecked',  -- 아직 체크 안 함
  'present',    -- 출석
  'late',       -- 지각
  'absent',     -- 결석
  'excused'     -- 사유 있는 불참 (출석률 계산에서 제외)
);
create type public.activity_category as enum ('document', 'task', 'meeting', 'file');
create type public.activity_type as enum (
  'doc_edit',        -- 일반 문서 편집 (document_revisions)
  'task_create',     -- 태스크 생성
  'task_complete',   -- 태스크 완료 (팀원 확인 시 meta.verified = true)
  'meeting_note',    -- 회의록 편집 (kind = meeting_note 문서의 revision)
  'meeting_attend',  -- 회의 참석
  'file_version'     -- 파일 새 버전 업로드 (file_versions)
);

-- ---------- 사용자 ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'student',
  name        text not null,
  email       text,
  student_no  text,
  department  text,
  created_at  timestamptz not null default now()
);

-- ---------- 과목 ----------
create table public.courses (
  id               uuid primary key default gen_random_uuid(),
  professor_id     uuid not null references public.profiles (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  semester         text not null,                       -- 예: '2026-2'
  invite_code      text not null unique
                   default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  -- 기여도 카테고리 가중치 (교수가 조정, 합 100)
  weight_document  int not null default 40,
  weight_task      int not null default 30,
  weight_meeting   int not null default 15,
  weight_file      int not null default 15,
  created_at       timestamptz not null default now(),
  constraint courses_weights_nonneg
    check (least(weight_document, weight_task, weight_meeting, weight_file) >= 0),
  constraint courses_weights_sum_100
    check (weight_document + weight_task + weight_meeting + weight_file = 100)
);

create table public.course_members (
  course_id  uuid not null references public.courses (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (course_id, user_id)
);

-- ---------- 팀 ----------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now(),
  unique (id, course_id),          -- team_members 복합 FK 용
  unique (course_id, name)
);

-- 한 학생은 과목당 한 팀에만 속함 + 과목 수강생만 팀원이 될 수 있음
create table public.team_members (
  team_id    uuid not null,
  course_id  uuid not null,
  user_id    uuid not null,
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (course_id, user_id),
  foreign key (team_id, course_id) references public.teams (id, course_id) on delete cascade,
  foreign key (course_id, user_id) references public.course_members (course_id, user_id) on delete cascade
);
create index team_members_user_idx on public.team_members (user_id);

-- ---------- 태스크 (칸반) ----------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  description   text,
  status        public.task_status not null default 'todo',
  position      double precision not null default 0,     -- 칸반 컬럼 내 정렬
  assignee_id   uuid references public.profiles (id) on delete set null,
  created_by    uuid not null default auth.uid() references public.profiles (id),
  due_date      date,
  completed_by  uuid references public.profiles (id),    -- 트리거가 채움
  completed_at  timestamptz,
  verified_by   uuid references public.profiles (id),    -- 다른 팀원의 완료 확인
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tasks_team_idx on public.tasks (team_id, status, position);

-- ---------- 문서 (Tiptap) ----------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  kind          public.document_kind not null default 'doc',
  title         text not null default '제목 없음',
  content       jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  content_text  text not null default '',
  version       int not null default 1,                  -- 낙관적 잠금
  created_by    uuid not null default auth.uid() references public.profiles (id),
  updated_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index documents_team_idx on public.documents (team_id, kind, updated_at desc);

-- 저장(1분 내 같은 작성자는 병합)마다 1행. 쓰기는 save_document RPC(서버)만.
create table public.document_revisions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents (id) on delete cascade,
  team_id        uuid not null references public.teams (id) on delete cascade,
  author_id      uuid not null references public.profiles (id),
  version        int not null,
  content        jsonb not null,
  content_text   text not null,
  chars_added    int not null default 0 check (chars_added >= 0),
  chars_removed  int not null default 0 check (chars_removed >= 0),
  pasted_chars   int not null default 0 check (pasted_chars >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index document_revisions_doc_idx on public.document_revisions (document_id, created_at desc);

-- ---------- 회의 ----------
create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  held_at      timestamptz not null default now(),
  location     text,                                   -- 예: 'ITBT 301호', 'Zoom'
  document_id  uuid unique references public.documents (id) on delete set null,  -- 회의록
  created_by   uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index meetings_team_idx on public.meetings (team_id, held_at desc);

-- 회의별 팀원 출결 + 한 줄 코멘트. 회의 생성 시 팀원 전원 'unchecked'로 자동 생성.
-- 본인 출결 상태는 다른 팀원만 체크 가능 (자기 출석 조작 방지), 코멘트(사유 등)는 본인도 작성 가능.
create table public.meeting_attendance (
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  status      public.attendance_status not null default 'unchecked',
  comment     text check (comment is null or length(comment) <= 300),
  checked_by  uuid references public.profiles (id),   -- 트리거가 채움
  checked_at  timestamptz,
  comment_by  uuid references public.profiles (id),   -- 트리거가 채움
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index meeting_attendance_team_user_idx on public.meeting_attendance (team_id, user_id);

-- 회의 전체에 대한 간단한 코멘트 (스레드)
create table public.meeting_comments (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body        text not null check (length(trim(body)) between 1 and 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index meeting_comments_meeting_idx on public.meeting_comments (meeting_id, created_at);

-- ---------- 파일 보관함 (버전 관리) ----------
create table public.files (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams (id) on delete cascade,
  name            text not null,                         -- 예: 발표자료.pptx
  extension       text,                                  -- pptx / docx / xlsx / hwpx / pdf ...
  latest_version  int not null default 0,
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (team_id, name)
);

-- 쓰기는 register_file_version RPC(서버, 텍스트 추출 후)만.
create table public.file_versions (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid not null references public.files (id) on delete cascade,
  team_id         uuid not null references public.teams (id) on delete cascade,
  version         int not null,
  uploader_id     uuid not null references public.profiles (id),
  storage_path    text not null,                         -- team-files 버킷 내 경로
  mime_type       text,
  size_bytes      bigint,
  extracted_text  text,                                  -- 분석 불가 포맷은 null
  chars_added     int not null default 0 check (chars_added >= 0),
  chars_removed   int not null default 0 check (chars_removed >= 0),
  change_summary  jsonb not null default '{}'::jsonb,    -- 예: {"slides_changed":[3,5],"slides_added":[9]}
  created_at      timestamptz not null default now(),
  unique (file_id, version)
);
create index file_versions_file_idx on public.file_versions (file_id, version desc);

-- ---------- 활동 이벤트 (기여 증거의 단일 원천) ----------
-- 클라이언트는 직접 쓸 수 없음. 트리거 / 서버 RPC만 기록.
create table public.activity_events (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  category    public.activity_category not null,
  type        public.activity_type not null,
  amount      numeric not null default 0,   -- 원시 양 (유효 글자 수, 횟수 등)
  points      numeric not null default 0,   -- compute_points()가 채우는 점수
  ref_table   text not null,
  ref_id      uuid not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (type, ref_id, user_id)
);
create index activity_events_team_user_idx on public.activity_events (team_id, user_id);
create index activity_events_team_time_idx on public.activity_events (team_id, created_at);

-- 팀원 인정(👍): 다른 팀원의 활동을 확인
create table public.kudos (
  event_id    uuid not null references public.activity_events (id) on delete cascade,
  giver_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  team_id     uuid not null references public.teams (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, giver_id)
);

-- 팀원 상호평가 (기존 방식 — 활동 데이터와 불일치 비교용)
create table public.peer_reviews (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  reviewer_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reviewee_id  uuid not null references public.profiles (id) on delete cascade,
  score        int not null check (score between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, reviewer_id, reviewee_id),
  check (reviewer_id <> reviewee_id)
);

-- AI 기여 요약 리포트 캐시 (서버가 Claude API 호출 후 저장)
create table public.ai_reports (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  summary     text not null,
  evidence    jsonb not null default '[]'::jsonb,   -- [{event_id, label}]
  model       text not null,
  created_at  timestamptz not null default now()
);
create index ai_reports_team_user_idx on public.ai_reports (team_id, user_id, created_at desc);
