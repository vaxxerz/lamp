export interface User {
  id: string;
  name: string;
  email: string;
}
export interface TeamMember {
  userId: string;
  role: "leader" | "member";
}
export type TeamTrack = "independent" | "class";
export interface Team {
  id: string;
  name: string;
  courseName: string;
  members: TeamMember[];
  /** independent: 학생끼리(교수 없음, 팀 초대코드) / class: 과목 코드 + 교수 열람 */
  track: TeamTrack;
  inviteCode?: string | null;
}
/** 팀 전환 메뉴용 */
export interface TeamSummary {
  id: string;
  name: string;
  courseName: string;
  track: TeamTrack;
  memberCount: number;
}
export type AttributionStatus = "verified" | "inferred" | "unknown";
export interface ConnectedDocument {
  id: string;
  teamId: string;
  name: string;
  type: "docs" | "slides" | "sheets";
  sourceUrl: string;
  updatedAt: string | null;
  changeCount: number;
}
export interface ContributionActivity {
  id: string;
  teamId: string;
  documentId: string;
  userId: string | null;
  title: string;
  actionType: "add" | "edit" | "delete";
  contentBefore: string | null;
  contentAfter: string | null;
  timestamp: string;
  attributionStatus: AttributionStatus;
  sourceUrl: string;
  /** 팀원과 매칭되지 않은 작성자의 구글 표시 이름 (실데이터) */
  authorName?: string | null;
  /** 실데이터 구글 수정 상세: 편집 시간대(Activity 기준), 바뀐 부분, 공동 편집 비율 */
  editedFrom?: string | null;
  editedTo?: string | null;
  fragments?: ChangeFragment[];
  shares?: { userId: string | null; name: string; share: number }[];
}
export interface ChangeFragment {
  line: number;
  added?: string;
  removed?: string;
  before?: string;
  after?: string;
}
export type AttendanceStatus =
  "unchecked" | "present" | "late" | "absent" | "excused";
export interface Meeting {
  id: string;
  teamId: string;
  title: string;
  heldAt: string;
  location: string;
  notes: string;
  attendance: Record<string, AttendanceStatus>;
  /** 실데이터: 회의록 문서 id · 버전 (저장 시 낙관적 잠금) */
  noteDocumentId?: string | null;
  noteVersion?: number;
  /** 실데이터: 팀원별 출결 한 줄 코멘트, 회의 코멘트 */
  attendanceComments?: Record<string, string | null>;
  comments?: MeetingComment[];
}
export interface MeetingComment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}
export type TaskStatus = "todo" | "doing" | "done";
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  position: number;
  assigneeId: string | null;
  createdBy: string;
  completedBy: string | null;
  verifiedBy: string | null;
  description?: string | null;
  dueDate?: string | null;
}
export interface FileVersion {
  version: number;
  uploaderId: string;
  createdAt: string;
  sizeBytes: number | null;
  storagePath: string;
  charsAdded: number;
  charsRemoved: number;
  summary: { slides_changed?: number[]; slides_added?: number[]; slides_removed?: number };
}
export interface TeamFile {
  id: string;
  name: string;
  latestVersion: number;
  updatedAt: string;
  versions: FileVersion[];
}
/** activity_events 1건 (점수의 근거) + 받은 👍 */
export interface ActivityEvent {
  id: string;
  userId: string;
  category: "document" | "task" | "meeting" | "file";
  type: string;
  points: number;
  createdAt: string;
  meta: Record<string, unknown>;
  kudosFrom: string[];
}
/** get_team_contributions */
export interface ContributionScore {
  user_id: string;
  name: string;
  document_score: number;
  task_score: number;
  meeting_score: number;
  file_score: number;
  share_pct: number;
  peer_share_pct: number | null;
  mismatch: boolean;
  event_count: number;
  kudos_received: number;
}
/** /lamp 화면 전체가 쓰는 작업 공간 (실데이터 또는 Mock) */
export interface Workspace {
  mode: "live" | "mock";
  me: User;
  team: Team;
  /** 내가 속한 모든 팀 (실데이터) */
  teams: TeamSummary[];
  users: User[];
  documents: ConnectedDocument[];
  activities: ContributionActivity[];
  meetings: Meeting[];
  /** 아래는 실데이터 전용 (Mock에서는 빈 배열) */
  tasks: Task[];
  files: TeamFile[];
  events: ActivityEvent[];
  scores: ContributionScore[];
}
