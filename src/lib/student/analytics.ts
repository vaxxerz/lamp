// 분석 엔진 (1차: 규칙 기반 집계) — 순수 함수, DB · 네트워크 의존 없음
//  나중에 분석 엔진 · AI API를 붙일 때는 같은 입력(ContributionPoint[])을 받아
//  같은 출력(WeekBucket[] · MemberStat[])을 돌려주면 화면은 그대로 쓸 수 있다.

/** 기여 1건 (activity_events 1행을 정규화한 것) */
export type ContributionPoint = {
  userId: string;
  at: string; // ISO
  points: number;
  added: number; // 추가한 글자
  removed: number; // 삭제한 글자
  category: "document" | "task" | "meeting" | "file";
};

export type WeekBucket = {
  start: string; // 그 주 월요일 (YYYY-MM-DD, 한국 시간)
  count: number;
  points: number;
};

export type MemberStat = {
  userId: string;
  count: number;
  points: number;
  added: number;
  removed: number;
  weeks: WeekBucket[];
  byCategory: Record<ContributionPoint["category"], number>;
};

export type Period = "1m" | "3m" | "all";
const DAY = 86_400_000;
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { "1m": 30, "3m": 91 };

/** 한국 시간 기준 그 주 월요일 */
export function weekStart(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 3_600_000);
  const dow = (kst.getUTCDay() + 6) % 7; // 월 = 0
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}

/** 기간 안의 기여만 (now 기준). all이면 전부 */
export function inPeriod(points: ContributionPoint[], period: Period, now = Date.now()) {
  if (period === "all") return points;
  const from = now - PERIOD_DAYS[period] * DAY;
  return points.filter((p) => Date.parse(p.at) >= from);
}

/** 연속된 주 목록 (빈 주도 0으로 채움) — 시작 주 ~ 이번 주 */
export function weekRange(points: ContributionPoint[], period: Period, now = Date.now()): string[] {
  const first =
    period === "all"
      ? points.reduce((m, p) => Math.min(m, Date.parse(p.at)), now)
      : now - PERIOD_DAYS[period] * DAY;
  const weeks: string[] = [];
  for (let w = weekStart(new Date(first).toISOString()); w <= weekStart(new Date(now).toISOString()); ) {
    weeks.push(w);
    w = new Date(Date.parse(`${w}T00:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
  }
  return weeks;
}

export function bucketWeeks(points: ContributionPoint[], weeks: string[]): WeekBucket[] {
  const map = new Map(weeks.map((w) => [w, { start: w, count: 0, points: 0 }]));
  for (const p of points) {
    const b = map.get(weekStart(p.at));
    if (!b) continue;
    b.count += 1;
    b.points += p.points;
  }
  return weeks.map((w) => {
    const b = map.get(w)!;
    return { ...b, points: Math.round(b.points * 10) / 10 };
  });
}

/** 팀원별 통계 (활동 수 많은 순 — GitHub Contributors처럼) */
export function memberStats(points: ContributionPoint[], userIds: string[], weeks: string[]): MemberStat[] {
  return userIds
    .map((userId) => {
      const mine = points.filter((p) => p.userId === userId);
      const byCategory = { document: 0, task: 0, meeting: 0, file: 0 };
      for (const p of mine) byCategory[p.category] += 1;
      return {
        userId,
        count: mine.length,
        points: Math.round(mine.reduce((n, p) => n + p.points, 0) * 10) / 10,
        added: mine.reduce((n, p) => n + p.added, 0),
        removed: mine.reduce((n, p) => n + p.removed, 0),
        weeks: bucketWeeks(mine, weeks),
        byCategory,
      };
    })
    .sort((a, b) => b.count - a.count || b.points - a.points);
}
