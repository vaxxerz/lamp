// 교수용 팀원 분석 — 프로젝트(팀)마다 팀원별로 기록에서 나온 사실만 모은다. 순수 함수, DB · 네트워크 의존 없음.
//  근거: 연결 문서의 변경 기록(작성자 확인 · 추정)과 회의 출석. 작성자 미확인 기록은 개인에게 붙이지 않는다.
//  "살펴볼 점"은 사실(기록 없음 · 쉰 기간 · 쏠림 · 결석)만 적는다. 성적 · 공정성은 판정하지 않는다.
import type { ContributionActivity } from "@/lib/student/types";
import type { ProfessorData } from "./types";

export type AnalysisPeriod = "1m" | "3m" | "all";
const DAY = 86_400_000;
const PERIOD_DAYS = { "1m": 30, "3m": 91 } as const;
/** 이 기간 넘게 기록이 없으면 "쉰 기간"으로 알려준다 */
export const IDLE_DAYS = 14;
/** 한 사람 변경량 비중이 이 이상이면 쏠림으로 알려준다 (팀원 3명 이상일 때) */
export const CONCENTRATION = 0.6;

export type MemberAnalysis = {
  userId: string;
  name: string;
  role: "leader" | "member";
  /** 팀 안에서의 순서 (아바타 · 색 고정용) */
  index: number;
  /** 작성자가 확인 · 추정된 변경 기록 수 */
  count: number;
  byCategory: Readonly<Record<"document" | "task" | "meeting" | "file", number>>;
  verified: number;
  inferred: number;
  added: number;
  removed: number;
  /** 팀의 개인 귀속 변경량(추가+삭제 글자) 중 비중 0..1 */
  share: number;
  docs: number;
  activeWeeks: number;
  weeks: { start: string; count: number }[];
  lastAt: string | null;
  attendance: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    /** 출결이 체크된 회의 수 */
    checked: number;
  };
  notes: string[];
};

export type TeamAnalysis = {
  teamId: string;
  total: number;
  verified: number;
  inferred: number;
  unknown: number;
  weeks: { start: string; count: number }[];
  members: MemberAnalysis[];
  meetings: number;
  notes: string[];
};

/** 한국 시간 기준 그 주 월요일 (YYYY-MM-DD) */
export function weekStart(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 3_600_000);
  const dow = (kst.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow),
  )
    .toISOString()
    .slice(0, 10);
}

function weekRange(fromMs: number, now: number): string[] {
  const weeks: string[] = [];
  const last = weekStart(new Date(now).toISOString());
  for (let w = weekStart(new Date(fromMs).toISOString()); w <= last;) {
    weeks.push(w);
    w = new Date(Date.parse(`${w}T00:00:00Z`) + 7 * DAY)
      .toISOString()
      .slice(0, 10);
  }
  return weeks;
}

const letters = (s: string | null | undefined) =>
  s ? s.replace(/\s/g, "").length : 0;

/** 변경 1건의 추가 · 삭제 글자. 실데이터 직접 수정은 제목에 적힌 글자 수(+N / −M자)를 쓴다 */
export function changeSize(a: ContributionActivity) {
  const m = a.title.match(/\(\+(\d+) \/ [−-](\d+)자\)$/);
  if (m) return { added: Number(m[1]), removed: Number(m[2]) };
  if (a.fragments?.length)
    return {
      added: a.fragments.reduce((n, f) => n + letters(f.added), 0),
      removed: a.fragments.reduce((n, f) => n + letters(f.removed), 0),
    };
  return { added: letters(a.contentAfter), removed: letters(a.contentBefore) };
}

/** 이 기록의 변경량을 누구에게 얼마씩 붙일지 — 공동 편집이면 편집 비율로 나눈다 */
function credits(a: ContributionActivity): { userId: string; share: number }[] {
  if (a.attributionStatus === "unknown") return [];
  const linked = (a.shares ?? []).filter(
    (s): s is { userId: string; name: string; share: number } => !!s.userId,
  );
  if (linked.length) {
    const sum = (a.shares ?? []).reduce((n, s) => n + s.share, 0) || 1;
    return linked.map((s) => ({ userId: s.userId, share: s.share / sum }));
  }
  return a.userId ? [{ userId: a.userId, share: 1 }] : [];
}

export function periodStart(period: AnalysisPeriod, now: number) {
  return period === "all" ? null : now - PERIOD_DAYS[period] * DAY;
}

export function analyzeTeam(
  data: ProfessorData,
  teamId: string,
  {
    period = "all",
    now = Date.now(),
  }: { period?: AnalysisPeriod; now?: number } = {},
): TeamAnalysis {
  const team = data.teams.find((t) => t.id === teamId);
  const from = periodStart(period, now);
  const inRange = (iso: string) => from === null || Date.parse(iso) >= from;
  const acts = data.activities.filter(
    (a) => a.teamId === teamId && inRange(a.timestamp),
  );
  const allActs = data.activities.filter((a) => a.teamId === teamId);
  const meetings = data.meetings.filter(
    (m) => m.teamId === teamId && inRange(m.heldAt),
  );
  const first =
    from ?? acts.reduce((m, a) => Math.min(m, Date.parse(a.timestamp)), now);
  const weeks = weekRange(first, now);
  const bucket = (list: ContributionActivity[]) => {
    const map = new Map(weeks.map((w) => [w, 0]));
    for (const a of list) {
      const w = weekStart(a.timestamp);
      if (map.has(w)) map.set(w, map.get(w)! + 1);
    }
    return weeks.map((start) => ({ start, count: map.get(start)! }));
  };

  // 개인 귀속 변경량
  const volume = new Map<string, { added: number; removed: number }>();
  for (const a of acts) {
    const size = changeSize(a);
    for (const c of credits(a)) {
      const v = volume.get(c.userId) ?? { added: 0, removed: 0 };
      v.added += size.added * c.share;
      v.removed += size.removed * c.share;
      volume.set(c.userId, v);
    }
  }
  const memberIds = (team?.members ?? []).map((m) => m.userId);
  const teamVolume = memberIds.reduce(
    (n, id) =>
      n + (volume.get(id)?.added ?? 0) + (volume.get(id)?.removed ?? 0),
    0,
  );

  const members: MemberAnalysis[] = (team?.members ?? []).map((tm, index) => {
    const mine = acts.filter(
      (a) => a.attributionStatus !== "unknown" && a.userId === tm.userId,
    );
    const v = volume.get(tm.userId) ?? { added: 0, removed: 0 };
    const byCategory = { document: 0, task: 0, meeting: 0, file: 0 };
    if (data.events) {
      for (const event of data.events) {
        if (event.teamId === teamId && event.userId === tm.userId && inRange(event.createdAt)) byCategory[event.category]++;
      }
    } else {
      byCategory.document = mine.length;
    }
    const memberWeeks = bucket(mine);
    const lastAt =
      allActs
        .filter(
          (a) =>
            a.attributionStatus !== "unknown" &&
            (a.userId === tm.userId ||
              a.shares?.some((s) => s.userId === tm.userId)),
        )
        .map((a) => a.timestamp)
        .sort()
        .at(-1) ?? null;
    const attendance = {
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      checked: 0,
    };
    for (const m of meetings) {
      const s = m.attendance[tm.userId];
      if (!s || s === "unchecked") continue;
      attendance[s] += 1;
      attendance.checked += 1;
    }
    const share = teamVolume ? (v.added + v.removed) / teamVolume : 0;
    const notes: string[] = [];
    if (!lastAt) notes.push("기록된 변경 없음");
    else if (now - Date.parse(lastAt) > IDLE_DAYS * DAY)
      notes.push(
        `${Math.floor((now - Date.parse(lastAt)) / DAY)}일째 변경 없음`,
      );
    if (attendance.absent >= 2) notes.push(`결석 ${attendance.absent}회`);
    if (
      mine.length >= 3 &&
      mine.every((a) => a.attributionStatus === "inferred")
    )
      notes.push("직접 수정(추정)만 있음");
    return {
      userId: tm.userId,
      name: data.users.find((u) => u.id === tm.userId)?.name ?? "학생",
      role: tm.role,
      index,
      count: mine.length,
      byCategory,
      verified: mine.filter((a) => a.attributionStatus === "verified").length,
      inferred: mine.filter((a) => a.attributionStatus === "inferred").length,
      added: Math.round(v.added),
      removed: Math.round(v.removed),
      share,
      docs: new Set(mine.map((a) => a.documentId)).size,
      activeWeeks: memberWeeks.filter((w) => w.count > 0).length,
      weeks: memberWeeks,
      lastAt,
      attendance,
      notes,
    };
  });

  const unknown = acts.filter((a) => a.attributionStatus === "unknown").length;
  const notes: string[] = [];
  const top = [...members].sort((a, b) => b.share - a.share)[0];
  if (members.length >= 3 && top && top.share >= CONCENTRATION) {
    notes.push(`변경량 ${Math.round(top.share * 100)}%가 ${top.name}`);
    top.notes.unshift("변경량 쏠림");
  }
  const silent = members.filter((m) =>
    m.notes.some((n) => n.includes("변경 없음")),
  );
  if (members.length && silent.length)
    notes.push(`변경 없는 팀원 ${silent.length}명`);
  if (acts.length >= 3 && unknown / acts.length >= 0.3)
    notes.push("작성자 미확인 기록 많음");

  return {
    teamId,
    total: acts.length,
    verified: acts.filter((a) => a.attributionStatus === "verified").length,
    inferred: acts.filter((a) => a.attributionStatus === "inferred").length,
    unknown,
    weeks: bucket(acts),
    members: members.sort(
      (a, b) => b.share - a.share || b.count - a.count || a.index - b.index,
    ),
    meetings: meetings.length,
    notes,
  };
}
