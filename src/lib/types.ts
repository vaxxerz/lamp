// DB enum · RPC 반환 타입 (supabase/migrations 와 동기화)
// TODO(A): Supabase 프로젝트 연결 후 `npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts`

export type UserRole = "student" | "professor";
export type TaskStatus = "todo" | "doing" | "done";
export type AttendanceStatus = "unchecked" | "present" | "late" | "absent" | "excused";
export type ActivityCategory = "document" | "task" | "meeting" | "file";
export type ActivityType =
  | "doc_edit"
  | "task_create"
  | "task_complete"
  | "meeting_note"
  | "meeting_attend"
  | "file_version"
  | "external_doc_edit"; // 구글 문서·슬라이드·시트 수정

export type Profile = {
  id: string;
  role: UserRole;
  name: string;
  email: string | null;
  student_no: string | null;
  department: string | null;
};

/** get_team_contributions(team_id) */
export type Contribution = {
  user_id: string;
  name: string;
  document_score: number;
  task_score: number;
  meeting_score: number;
  file_score: number;
  raw_points: number;
  share_pct: number;
  peer_avg: number | null;
  peer_share_pct: number | null;
  mismatch: boolean;
  event_count: number;
  kudos_received: number;
};

/** get_team_attendance(team_id) */
export type AttendanceSummary = {
  user_id: string;
  name: string;
  meetings_total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  unchecked: number;
  attendance_rate: number | null;
};

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  unchecked: "미체크",
  present: "출석",
  late: "지각",
  absent: "결석",
  excused: "사유 불참",
};

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  document: "문서",
  task: "태스크",
  meeting: "회의",
  file: "파일",
};
