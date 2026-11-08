import type {
  User,
  TeamMember,
  ConnectedDocument,
  ContributionActivity,
  Meeting,
} from "@/lib/student/types";
export interface Course {
  id: string;
  name: string;
  professorId: string;
  inviteCode: string;
  /** 실데이터: 학기 (예: 2026-2) */
  semester?: string;
}
export interface ProfessorTeam {
  id: string;
  courseId: string;
  name: string;
  members: TeamMember[];
  /** Mock만 안다. 실데이터에는 만든 사람 기록이 없어 null */
  createdBy: "student" | "professor" | null;
  /** 수업 과목의 팀은 과목 코드로 참여하므로 팀 코드가 없다 (null) */
  inviteCode: string | null;
}
export interface ProfessorMeeting extends Meeting {
  confirmations: Record<string, { userId: string; at: string }>;
}
export interface ProfessorData {
  /** live: Supabase 실데이터 (/professor), mock: 공개 예시 (/professor-demo) */
  mode?: "live" | "mock";
  professor: { id: string; name: string; role: "professor" };
  courses: Course[];
  teams: ProfessorTeam[];
  users: User[];
  documents: ConnectedDocument[];
  activities: ContributionActivity[];
  meetings: ProfessorMeeting[];
  events?: readonly {
    readonly teamId: string;
    readonly userId: string;
    readonly category: "document" | "task" | "meeting" | "file";
    readonly createdAt: string;
  }[];
}
export interface ProfessorReport {
  teamId: string;
  userId: string | null;
  summary: string;
  activityIds: string[];
  generatedAt: string;
}
