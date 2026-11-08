// AI 기여 분석 — 입력 · 출력 형식 (docs/ANALYSIS_REPORT.md 2 · 4절)
//  서버(/api/ai-report)와 화면이 함께 쓴다. 순수 타입 + zod 스키마, DB · 네트워크 의존 없음.
import { z } from "zod";

export type AnalysisPeriodKey = "1m" | "3m" | "all";
/** 누가 읽는 보고서인가 — 교수용에는 면담 질문이 붙고, 학생용은 다음 행동 제안 위주 */
export type Audience = "student" | "professor";
export type EventCategory = "document" | "task" | "meeting" | "file";
export type Attribution = "verified" | "inferred";

export interface AnalysisEvent {
  id: string;
  userId: string;
  category: EventCategory;
  type: string;
  points: number;
  createdAt: string;
  attribution: Attribution;
  /** 화면 · 프롬프트용 한 줄 설명 (예: "최종 보고서 제안 +120자") */
  label: string;
  /** 내용 근거 원문 조각 (300자 이내) */
  excerpt?: string;
  added?: number;
  removed?: number;
}

export interface AnalysisInput {
  version: 1;
  team: {
    id: string;
    name: string;
    track: "class" | "independent";
    course?: { name: string; weights?: Record<EventCategory, number> };
  };
  period: { key: AnalysisPeriodKey; from: string; to: string };
  members: { id: string; name: string; role?: "leader" | "member" }[];
  events: AnalysisEvent[];
  /** 과목 가중치가 반영된 전체 기간 점수 (get_team_contributions). Mock은 없음 */
  scores?: {
    userId: string;
    sharePct: number;
    peerSharePct: number | null;
    mismatch: boolean;
    kudos: number;
  }[];
  meetings: {
    id: string;
    title: string;
    heldAt: string;
    attendance: Record<string, string>;
  }[];
  tasks: {
    title: string;
    status: string;
    assigneeId: string | null;
    completedBy: string | null;
  }[];
}

// ---------- 출력 ----------
export const PATTERNS = ["steady", "burst", "late", "inactive", "sparse"] as const;
export type Pattern = (typeof PATTERNS)[number];
export const ALERT_TYPES = [
  "free_rider",
  "last_minute",
  "mismatch",
  "silent_member",
  "concentration",
  "low_confidence",
] as const;

export const AlertSchema = z.object({
  type: z.enum(ALERT_TYPES),
  severity: z.enum(["info", "warning", "critical"]),
  userIds: z.array(z.string()),
  message: z.string(),
  evidenceIds: z.array(z.string()),
});
export type Alert = z.infer<typeof AlertSchema>;

export const HighlightSchema = z.object({
  label: z.string(),
  evidenceIds: z.array(z.string()),
});
export type Highlight = z.infer<typeof HighlightSchema>;

export interface MemberReport {
  userId: string;
  name: string;
  summary: string;
  /** 맡은 역할을 기록에서 읽어낸 한 단어 (예: "문서 작성 · 정리") */
  role: string;
  highlights: Highlight[];
  strengths: string[];
  /** 학생용: 다음에 해볼 일 / 교수용: 확인해볼 점 */
  suggestions: string[];
  /** 교수용 면담 질문 (학생용은 빈 배열) */
  questions: string[];
  pattern: Pattern;
  patternNote: string;
  share: { activityPct: number; scorePct: number | null; volumePct: number };
  metrics: {
    events: number;
    verified: number;
    inferred: number;
    added: number;
    removed: number;
    activeWeeks: number;
    byCategory: Record<EventCategory, number>;
    tasksDone: number;
    meetingsPresent: number;
    meetingsChecked: number;
    lastAt: string | null;
  };
  weeks: { start: string; count: number }[];
  confidence: "high" | "medium" | "low";
  flags: Alert[];
}

export interface AnalysisReport {
  version: 1;
  teamId: string;
  audience: Audience;
  period: AnalysisInput["period"];
  generatedAt: string;
  /** "rules-v1" 또는 "rules-v1 + <모델>" */
  model: string;
  /** AI 문장 생성이 실패 · 꺼져 있으면 이유 (규칙 결과만 표시) */
  aiStatus: "ok" | "disabled" | "failed" | "mock";
  team: {
    headline: string;
    summary: string;
    balance: { topSharePct: number; activeMembers: number; totalMembers: number; gini: number };
    totals: { events: number; verified: number; inferred: number; weeks: number; activeWeeks: number };
    weeks: { start: string; count: number }[];
    /** 프로젝트 흐름 (주 구간별) */
    phases: { from: string; to: string; title: string; description: string }[];
    alerts: Alert[];
    recommendations: string[];
  };
  members: MemberReport[];
  /** 인용된 근거 이벤트만 (화면에서 근거 펼치기용) */
  evidence: Record<string, { label: string; at: string; attribution: Attribution; excerpt?: string }>;
  limitations: string[];
}

// ---------- Claude가 쓰는 부분 (문장만 · 숫자는 규칙 결과 그대로) ----------
export const AiNarrativeSchema = z.object({
  team: z.object({
    headline: z.string().describe("40자 이내 한 줄 요약"),
    summary: z.string().describe("2~4문장 팀 요약"),
    phases: z
      .array(
        z.object({
          from: z.string().describe("시작 주 (입력 weeks의 start 값)"),
          to: z.string().describe("끝 주 (입력 weeks의 start 값)"),
          title: z.string(),
          description: z.string(),
        }),
      )
      .describe("프로젝트 흐름 2~4단계"),
    recommendations: z.array(z.string()).describe("팀 단위 제안 2~4개"),
    alertMessages: z
      .array(z.object({ index: z.number().int(), message: z.string() }))
      .describe("입력 alerts의 index별로 다듬은 문장"),
  }),
  members: z.array(
    z.object({
      ref: z.string().describe("입력 members[].ref 값 (m1, m2 …)"),
      role: z.string().describe("기록에서 읽히는 역할, 15자 이내"),
      summary: z.string().describe("3문장 이내"),
      highlights: z
        .array(
          z.object({
            label: z.string(),
            evidence: z.array(z.string()).describe("입력 이벤트 ref (e1, e2 …)"),
          }),
        )
        .describe("최대 5개, 중요한 순"),
      strengths: z.array(z.string()).describe("0~3개"),
      suggestions: z.array(z.string()).describe("1~3개"),
      questions: z.array(z.string()).describe("교수용일 때만 1~3개, 학생용이면 빈 배열"),
    }),
  ),
});
export type AiNarrative = z.infer<typeof AiNarrativeSchema>;
