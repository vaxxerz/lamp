// AI 기여 분석 — 규칙 엔진 (rules-v1). 순수 함수, DB · 네트워크 의존 없음.
//  1) 입력(AnalysisInput)에서 지표 · 패턴 · 경고를 계산하고 문장도 규칙으로 채운다 (AI 실패 시 그대로 표시)
//  2) Claude에게 줄 압축 입력(promptPayload)을 만들고, 돌아온 문장(AiNarrative)을 근거 검사 후 합친다
//  규칙: 근거 없는 주장 금지 · 확정/추정 구분 · 양과 흔적만 말하고 품질 · 인성은 평가하지 않는다.
import type { ContributionActivity, Meeting } from "@/lib/student/types";
import type {
  AiNarrative,
  Alert,
  AnalysisEvent,
  AnalysisInput,
  AnalysisPeriodKey,
  AnalysisReport,
  Audience,
  EventCategory,
  Highlight,
  MemberReport,
  Pattern,
} from "./types";

export const RULES_MODEL = "rules-v1";
const DAY = 86_400_000;
const PERIOD_DAYS = { "1m": 30, "3m": 91 } as const;
const CATEGORIES: EventCategory[] = ["document", "task", "meeting", "file"];
export const CATEGORY_LABEL: Record<EventCategory, string> = {
  document: "문서",
  task: "할 일",
  meeting: "회의",
  file: "파일",
};
export const PATTERN_LABEL: Record<Pattern, string> = {
  steady: "꾸준함",
  burst: "몰아치기",
  late: "막판 집중",
  inactive: "활동 없음",
  sparse: "간헐적",
};

/** 한국 시간 날짜 (YYYY-MM-DD) */
const kstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

/** 한국 시간 기준 그 주 월요일 */
export function weekStart(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 3_600_000);
  const dow = (kst.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow))
    .toISOString()
    .slice(0, 10);
}

/** 기간 키 → 시작 시각(ms, all이면 null) */
export function periodFromMs(key: AnalysisPeriodKey, now: number) {
  return key === "all" ? null : now - PERIOD_DAYS[key] * DAY;
}

export function periodRange(key: AnalysisPeriodKey, now: number, firstEventAt?: string | null) {
  const from = periodFromMs(key, now) ?? (firstEventAt ? Date.parse(firstEventAt) : now);
  return { key, from: kstDate(from), to: kstDate(now) };
}

function weekList(from: string, to: string): string[] {
  const weeks: string[] = [];
  const last = weekStart(`${to}T12:00:00+09:00`);
  for (let w = weekStart(`${from}T12:00:00+09:00`); w <= last; ) {
    weeks.push(w);
    w = new Date(Date.parse(`${w}T00:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
  }
  return weeks;
}

const bucket = (events: AnalysisEvent[], weeks: string[]) => {
  const map = new Map(weeks.map((w) => [w, 0]));
  for (const e of events) {
    const w = weekStart(e.createdAt);
    if (map.has(w)) map.set(w, map.get(w)! + 1);
  }
  return weeks.map((start) => ({ start, count: map.get(start)! }));
};

const round = (v: number) => Math.round(v);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 활동 수 분포의 지니 계수 (0 = 고르게, 1 = 한 사람에게 몰림) */
export function gini(values: number[]) {
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  if (n < 2 || !sum) return 0;
  let diff = 0;
  for (const a of values) for (const b of values) diff += Math.abs(a - b);
  return Math.round((diff / (2 * n * n * (sum / n))) * 100) / 100;
}

/** 패턴 판정 (docs/ANALYSIS_REPORT.md 규칙 지표 초안 + sparse) */
export function classifyPattern(
  events: AnalysisEvent[],
  weeks: { start: string; count: number }[],
  now: number,
): { pattern: Pattern; note: string } {
  const n = events.length;
  if (!n) return { pattern: "inactive", note: "이 기간 기록된 활동이 없어요" };
  if (weeks.length < 2) return { pattern: "steady", note: "기간이 1주라 패턴은 아직 판단하기 일러요" };
  const active = weeks.filter((w) => w.count > 0).length;
  const peak = weeks.reduce((m, w) => (w.count > m.count ? w : m), weeks[0] ?? { start: "", count: 0 });
  const last7 = events.filter((e) => now - Date.parse(e.createdAt) <= 7 * DAY).length;
  if (n >= 3 && weeks.length >= 3 && last7 / n >= 0.6)
    return { pattern: "late", note: `최근 7일에 활동 ${n}건 중 ${last7}건` };
  if (n >= 3 && weeks.length >= 2 && peak.count / n >= 0.6)
    return { pattern: "burst", note: `${md(peak.start)} 주에 활동 ${n}건 중 ${peak.count}건` };
  if (weeks.length && active / weeks.length >= 0.5)
    return { pattern: "steady", note: `${weeks.length}주 중 ${active}주 활동` };
  return { pattern: "sparse", note: `${weeks.length}주 중 ${active}주만 활동` };
}

/** 기간 중간에 2주 이상 연속 활동 0 (처음 활동 ~ 마지막 활동 사이) */
export function longestGap(weeks: { start: string; count: number }[]) {
  const first = weeks.findIndex((w) => w.count > 0);
  const last = weeks.findLastIndex((w) => w.count > 0);
  if (first < 0) return { length: 0, from: null as string | null };
  let best = { length: 0, from: null as string | null };
  let run = 0;
  for (let i = first; i <= last; i++) {
    if (weeks[i].count === 0) {
      run += 1;
      if (run > best.length) best = { length: run, from: weeks[i - run + 1].start };
    } else run = 0;
  }
  return best;
}

const confidenceOf = (verified: number, total: number): MemberReport["confidence"] =>
  !total ? "low" : verified / total >= 0.7 ? "high" : verified / total >= 0.4 ? "medium" : "low";

/** 근거로 고를 만한 이벤트 (확정 우선 → 점수 → 최신) */
function rankEvents(events: AnalysisEvent[]) {
  return [...events].sort(
    (a, b) =>
      Number(b.attribution === "verified") - Number(a.attribution === "verified") ||
      b.points - a.points ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

const withInferredMark = (label: string, events: AnalysisEvent[]) =>
  events.length && events.every((e) => e.attribution === "inferred") && !label.includes("추정")
    ? `${label} (추정)`
    : label;

// ---------------------------------------------------------------------------
// 1) 규칙 보고서
// ---------------------------------------------------------------------------
export function buildRulesReport(
  input: AnalysisInput,
  { audience = "student", now = Date.now() }: { audience?: Audience; now?: number } = {},
): AnalysisReport {
  const weeks = weekList(input.period.from, input.period.to);
  const events = input.events;
  const total = events.length;
  const verifiedTotal = events.filter((e) => e.attribution === "verified").length;
  const n = input.members.length;
  const volumeOf = (list: AnalysisEvent[]) => list.reduce((s, e) => s + (e.added ?? 0) + (e.removed ?? 0), 0);
  const teamVolume = volumeOf(events);
  const teamWeeks = bucket(events, weeks);

  const members: MemberReport[] = input.members.map((m) => {
    const mine = events.filter((e) => e.userId === m.id);
    const memberWeeks = bucket(mine, weeks);
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<EventCategory, number>;
    for (const e of mine) byCategory[e.category] += 1;
    const verified = mine.filter((e) => e.attribution === "verified").length;
    const score = input.scores?.find((s) => s.userId === m.id);
    let present = 0;
    let checked = 0;
    for (const mt of input.meetings) {
      const s = mt.attendance[m.id];
      if (!s || s === "unchecked") continue;
      checked += 1;
      if (s === "present" || s === "late") present += 1;
    }
    const { pattern, note } = classifyPattern(mine, memberWeeks, now);
    // 같은 설명의 기록은 하이라이트 하나로 묶는다 (근거 여러 건)
    const groups = new Map<string, AnalysisEvent[]>();
    for (const e of rankEvents(mine)) groups.set(e.label, [...(groups.get(e.label) ?? []), e]);
    const top = [...groups.values()].slice(0, 5);
    return {
      userId: m.id,
      name: m.name,
      summary: "",
      role: "",
      highlights: top.map((list) => ({
        label: withInferredMark(list[0].label, list) + (list.length > 1 ? ` ×${list.length}` : ""),
        evidenceIds: list.slice(0, 10).map((e) => e.id),
      })),
      strengths: [],
      suggestions: [],
      questions: [],
      pattern,
      patternNote: note,
      share: {
        activityPct: total ? round((mine.length / total) * 100) : 0,
        scorePct: score ? round(score.sharePct) : null,
        volumePct: teamVolume ? round((volumeOf(mine) / teamVolume) * 100) : 0,
      },
      metrics: {
        events: mine.length,
        verified,
        inferred: mine.length - verified,
        added: mine.reduce((s, e) => s + (e.added ?? 0), 0),
        removed: mine.reduce((s, e) => s + (e.removed ?? 0), 0),
        activeWeeks: memberWeeks.filter((w) => w.count > 0).length,
        byCategory,
        tasksDone: mine.filter((e) => e.type === "task_complete").length,
        meetingsPresent: present,
        meetingsChecked: checked,
        lastAt: mine.map((e) => e.createdAt).sort().at(-1) ?? null,
      },
      weeks: memberWeeks,
      confidence: confidenceOf(verified, mine.length),
      flags: [],
    };
  });

  // ---------- 경고 ----------
  const alerts: Alert[] = [];
  const shareFor = (m: MemberReport) => m.share.scorePct ?? m.share.activityPct;
  if (n >= 2 && total) {
    const threshold = (100 / n) * 0.3;
    for (const m of members) {
      if (m.metrics.events === 0)
        alerts.push({
          type: "free_rider",
          severity: "critical",
          userIds: [m.userId],
          message: `${m.name}님은 이 기간 기록된 활동이 없어요.`,
          evidenceIds: [],
        });
      else if (shareFor(m) < threshold)
        alerts.push({
          type: "free_rider",
          severity: "warning",
          userIds: [m.userId],
          message: `${m.name}님의 비중이 ${shareFor(m)}%로 균등 몫(${round(100 / n)}%)의 30%보다 낮아요.`,
          evidenceIds: rankEvents(events.filter((e) => e.userId === m.userId))
            .slice(0, 3)
            .map((e) => e.id),
        });
    }
  }
  const last7 = events.filter((e) => now - Date.parse(e.createdAt) <= 7 * DAY);
  if (total >= 5 && weeks.length >= 3 && last7.length / total >= 0.6)
    alerts.push({
      type: "last_minute",
      severity: "warning",
      userIds: [],
      message: `팀 활동의 ${round((last7.length / total) * 100)}%가 최근 7일에 몰렸어요.`,
      evidenceIds: rankEvents(last7).slice(0, 3).map((e) => e.id),
    });
  for (const s of input.scores ?? []) {
    const m = members.find((x) => x.userId === s.userId);
    if (m && s.mismatch)
      alerts.push({
        type: "mismatch",
        severity: "info",
        userIds: [m.userId],
        message: `${m.name}님의 활동 비중(${round(s.sharePct)}%)과 동료 평가 비중(${s.peerSharePct ?? "—"}%)이 많이 달라요.`,
        evidenceIds: [],
      });
  }
  for (const m of members) {
    const gap = longestGap(m.weeks);
    if (gap.length >= 2 && gap.from)
      alerts.push({
        type: "silent_member",
        severity: "info",
        userIds: [m.userId],
        message: `${m.name}님은 ${md(gap.from)} 주부터 ${gap.length}주 연속 활동이 없었어요.`,
        evidenceIds: [],
      });
  }
  const top = [...members].sort((a, b) => shareFor(b) - shareFor(a))[0];
  if (n >= 3 && top && shareFor(top) >= 60)
    alerts.push({
      type: "concentration",
      severity: "warning",
      userIds: [top.userId],
      message: `팀 기여의 ${shareFor(top)}%가 ${top.name}님에게 몰려 있어요.`,
      evidenceIds: [],
    });
  if (total >= 5 && verifiedTotal / total < 0.4)
    alerts.push({
      type: "low_confidence",
      severity: "info",
      userIds: [],
      message: `작성자가 확정된 기록이 ${round((verifiedTotal / total) * 100)}%뿐이라 개인 비중은 추정치가 많아요.`,
      evidenceIds: [],
    });
  for (const m of members) m.flags = alerts.filter((a) => a.userIds.includes(m.userId));

  // ---------- 규칙 문장 ----------
  const activeMembers = members.filter((m) => m.metrics.events > 0).length;
  const peakWeek = teamWeeks.reduce((m, w) => (w.count > m.count ? w : m), teamWeeks[0] ?? { start: "", count: 0 });
  const independent = input.team.track === "independent";
  for (const m of members) {
    const cats = CATEGORIES.filter((c) => m.metrics.byCategory[c])
      .map((c) => `${CATEGORY_LABEL[c]} ${m.metrics.byCategory[c]}건`)
      .join(" · ");
    m.role = m.metrics.events
      ? `${CATEGORY_LABEL[CATEGORIES.reduce((a, b) => (m.metrics.byCategory[b] > m.metrics.byCategory[a] ? b : a))]} 중심`
      : "기록 없음";
    m.summary = m.metrics.events
      ? `${m.name}님은 이 기간 활동 ${m.metrics.events}건(${cats})을 남겼고, 팀 활동의 ${m.share.activityPct}%예요. ` +
        (m.weeks.length >= 2 ? `${PATTERN_LABEL[m.pattern]} 패턴이에요 (${m.patternNote}).` : `${m.patternNote}.`) +
        (m.metrics.inferred ? ` 이 중 ${m.metrics.inferred}건은 작성자 추정 기록이에요.` : "")
      : `${m.name}님은 이 기간 기록된 활동이 없어요.`;
    if (m.pattern === "steady" && m.metrics.activeWeeks >= 3) m.strengths.push(`${m.metrics.activeWeeks}주에 걸쳐 꾸준히 참여했어요`);
    if (m.metrics.tasksDone) m.strengths.push(`할 일 ${m.metrics.tasksDone}건을 완료했어요`);
    if (m.metrics.meetingsChecked && m.metrics.meetingsPresent === m.metrics.meetingsChecked)
      m.strengths.push(`체크된 회의 ${m.metrics.meetingsChecked}회 모두 참석했어요`);
    if (m.pattern === "inactive")
      m.suggestions.push(
        audience === "professor" ? "기록 밖에서 맡은 일이 있는지 확인해 보세요" : "맡을 일을 보드에 올리고 담당자로 지정해 보세요",
      );
    if (m.pattern === "burst" || m.pattern === "late")
      m.suggestions.push(audience === "professor" ? "작업이 한 시기에 몰린 이유를 확인해 보세요" : "작업을 주 단위로 나눠 꾸준히 올려 보세요");
    if (m.confidence === "low" && m.metrics.events)
      m.suggestions.push(
        audience === "professor"
          ? "직접 수정(추정) 기록이 많아 실제 작성 범위를 확인해 보세요"
          : "구글 문서는 제안 모드로 쓰면 작성자가 확정돼요",
      );
    if (audience === "professor" && !independent) {
      if (m.metrics.events) m.questions.push(`가장 많은 시간을 쓴 작업은 무엇이었나요?`);
      if (m.pattern === "inactive") m.questions.push("기록되지 않은 방식으로 기여한 부분이 있나요?");
    }
  }
  const phases = buildPhases(teamWeeks);
  const recommendations: string[] = [];
  if (alerts.some((a) => a.type === "free_rider" || a.type === "concentration"))
    recommendations.push("역할과 담당 작업을 보드에 다시 나눠 적어 보세요");
  if (alerts.some((a) => a.type === "last_minute")) recommendations.push("마감 전 주에 몰리지 않도록 중간 점검 일정을 잡아 보세요");
  if (alerts.some((a) => a.type === "low_confidence")) recommendations.push("구글 문서 작업은 제안 모드로 남기면 기여가 정확히 기록돼요");
  if (!recommendations.length && total) recommendations.push("지금처럼 작업을 기록으로 남기며 진행해 보세요");

  return withEvidence(input, {
    version: 1,
    teamId: input.team.id,
    audience,
    period: input.period,
    generatedAt: new Date(now).toISOString(),
    model: RULES_MODEL,
    aiStatus: "disabled",
    team: {
      headline: !total
        ? "이 기간 기록된 활동이 없어요"
        : activeMembers < n
          ? `팀원 ${n}명 중 ${activeMembers}명만 활동을 남겼어요`
          : (alerts.find((a) => a.severity !== "info")?.message.slice(0, 40) ??
            `${n}명이 모두 참여해 활동 ${total}건을 남겼어요`),
      summary: total
        ? `${md(input.period.from)}~${md(input.period.to)} 동안 팀원 ${n}명 중 ${activeMembers}명이 활동 ${total}건을 남겼어요. ` +
          `가장 활발했던 주는 ${md(peakWeek.start)} 주(${peakWeek.count}건)이고, 작성자 확정 기록은 ${round((verifiedTotal / total) * 100)}%예요.`
        : "연결된 문서 · 할 일 · 회의 · 파일 기록이 쌓이면 분석이 채워져요.",
      balance: {
        topSharePct: top ? shareFor(top) : 0,
        activeMembers,
        totalMembers: n,
        gini: gini(members.map((m) => m.metrics.events)),
      },
      totals: {
        events: total,
        verified: verifiedTotal,
        inferred: total - verifiedTotal,
        weeks: weeks.length,
        activeWeeks: teamWeeks.filter((w) => w.count > 0).length,
      },
      weeks: teamWeeks,
      phases,
      alerts,
      recommendations,
    },
    members: members.sort((a, b) => b.metrics.events - a.metrics.events),
    limitations: [
      "구글 직접 수정은 편집 시간 비율로 나눈 추정치예요. 제안 모드 기록만 작성자가 확정돼요.",
      "활동의 양과 흔적만 봐요. 기여의 질이나 성적 · 공정성을 판정하지 않아요.",
      ...(input.scores?.length ? ["점수 비중은 과목 가중치가 반영된 전체 기간 값이에요."] : []),
    ],
    evidence: {},
  });
}

/** 보고서가 인용한 근거 이벤트의 라벨 · 시각을 붙인다 */
function withEvidence(input: AnalysisInput, report: AnalysisReport): AnalysisReport {
  const byId = new Map(input.events.map((e) => [e.id, e]));
  const ids = new Set([
    ...report.team.alerts.flatMap((a) => a.evidenceIds),
    ...report.members.flatMap((m) => m.highlights.flatMap((h) => h.evidenceIds)),
  ]);
  const evidence: AnalysisReport["evidence"] = {};
  for (const id of ids) {
    const e = byId.get(id);
    if (e) evidence[id] = { label: e.label, at: e.createdAt, attribution: e.attribution, ...(e.excerpt ? { excerpt: e.excerpt } : {}) };
  }
  return { ...report, evidence };
}

/** 주별 활동을 최대 3구간으로 나눠 흐름을 만든다 (규칙 문장) */
function buildPhases(weeks: { start: string; count: number }[]) {
  const first = weeks.findIndex((w) => w.count > 0);
  if (first < 0) return [];
  const span = weeks.slice(first);
  const size = Math.max(1, Math.ceil(span.length / 3));
  const names = ["초반", "중반", "후반"];
  const chunks = [0, 1, 2].map((i) => span.slice(i * size, (i + 1) * size)).filter((c) => c.length);
  const sum = span.reduce((s, w) => s + w.count, 0) || 1;
  return chunks.map((c, i) => {
    const count = c.reduce((s, w) => s + w.count, 0);
    return {
      from: c[0].start,
      to: c[c.length - 1].start,
      title: `${chunks.length === 1 ? "전체" : names[i]} · 활동 ${count}건`,
      description: `팀 활동의 ${round((count / sum) * 100)}%가 이 구간에 있어요.`,
    };
  });
}

// ---------------------------------------------------------------------------
// 2) Claude 입력 압축 · 결과 합치기
// ---------------------------------------------------------------------------
/** 팀원당 근거 후보 이벤트 수 (토큰 · 지연 제한) */
const EVENTS_PER_MEMBER = 40;

export function promptPayload(input: AnalysisInput, rules: AnalysisReport) {
  const refToId = new Map<string, string>();
  const memberRef = new Map<string, string>();
  input.members.forEach((m, i) => memberRef.set(m.id, `m${i + 1}`));
  let k = 0;
  const members = rules.members.map((m) => {
    const picked = rankEvents(input.events.filter((e) => e.userId === m.userId))
      .slice(0, EVENTS_PER_MEMBER)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      ref: memberRef.get(m.userId)!,
      name: m.name,
      role: input.members.find((x) => x.id === m.userId)?.role ?? "member",
      metrics: m.metrics,
      share: m.share,
      pattern: m.pattern,
      patternNote: m.patternNote,
      confidence: m.confidence,
      weeks: m.weeks.map((w) => w.count),
      events: picked.map((e) => {
        const ref = `e${++k}`;
        refToId.set(ref, e.id);
        return {
          ref,
          at: kstDate(Date.parse(e.createdAt)),
          category: e.category,
          type: e.type,
          attribution: e.attribution,
          label: e.label,
          ...(e.excerpt ? { excerpt: e.excerpt } : {}),
        };
      }),
    };
  });
  const payload = {
    team: {
      name: input.team.name,
      track: input.team.track,
      course: input.team.course?.name ?? null,
      weights: input.team.course?.weights ?? null,
    },
    period: input.period,
    weeks: rules.team.weeks.map((w) => w.start),
    teamWeeklyCounts: rules.team.weeks.map((w) => w.count),
    totals: rules.team.totals,
    balance: rules.team.balance,
    alerts: rules.team.alerts.map((a, index) => ({
      index,
      type: a.type,
      severity: a.severity,
      members: a.userIds.map((u) => memberRef.get(u)),
      draft: a.message,
    })),
    meetings: input.meetings.map((m) => ({
      title: m.title,
      at: kstDate(Date.parse(m.heldAt)),
      attendance: Object.fromEntries(Object.entries(m.attendance).map(([u, s]) => [memberRef.get(u) ?? "?", s])),
    })),
    tasks: input.tasks.map((t) => ({
      title: t.title,
      status: t.status,
      assignee: t.assigneeId ? (memberRef.get(t.assigneeId) ?? null) : null,
      completedBy: t.completedBy ? (memberRef.get(t.completedBy) ?? null) : null,
    })),
    members,
  };
  return { payload, refToId, memberRef };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Claude 문장을 규칙 보고서에 합친다 — 입력에 없는 근거 · 팀원은 버린다 */
export function mergeNarrative(
  rules: AnalysisReport,
  narrative: AiNarrative,
  refToId: Map<string, string>,
  memberRef: Map<string, string>,
  input: AnalysisInput,
  model: string,
): AnalysisReport {
  const byId = new Map(input.events.map((e) => [e.id, e]));
  const refToMember = new Map([...memberRef].map(([id, ref]) => [ref, id]));
  const weekSet = new Set(rules.team.weeks.map((w) => w.start));
  const professor = rules.audience === "professor" && input.team.track !== "independent";

  const members = rules.members.map((m) => {
    const ai = narrative.members.find((x) => refToMember.get(x.ref) === m.userId);
    if (!ai) return m;
    const highlights: Highlight[] = ai.highlights
      .map((h) => {
        const ids = h.evidence.map((r) => refToId.get(r)).filter((id): id is string => !!id && byId.get(id)?.userId === m.userId);
        return { label: clip(withInferredMark(h.label, ids.map((id) => byId.get(id)!)), 80), evidenceIds: [...new Set(ids)] };
      })
      .filter((h) => h.evidenceIds.length)
      .slice(0, 5);
    return {
      ...m,
      role: clip(ai.role, 20) || m.role,
      summary: clip(ai.summary, 400) || m.summary,
      highlights: highlights.length || !m.metrics.events ? highlights : m.highlights,
      strengths: ai.strengths.slice(0, 3).map((s) => clip(s, 120)),
      suggestions: ai.suggestions.slice(0, 3).map((s) => clip(s, 120)),
      questions: professor ? ai.questions.slice(0, 3).map((s) => clip(s, 140)) : [],
    };
  });
  const alerts = rules.team.alerts.map((a, i) => {
    const msg = narrative.team.alertMessages.find((x) => x.index === i)?.message;
    return msg ? { ...a, message: clip(msg, 200) } : a;
  });
  for (const m of members) m.flags = alerts.filter((a) => a.userIds.includes(m.userId));
  const phases = narrative.team.phases
    .filter((p) => weekSet.has(p.from) && weekSet.has(p.to) && p.from <= p.to)
    .slice(0, 4)
    .map((p) => ({ ...p, title: clip(p.title, 40), description: clip(p.description, 240) }));

  return withEvidence(input, {
    ...rules,
    model: `${RULES_MODEL} + ${model}`,
    aiStatus: "ok",
    team: {
      ...rules.team,
      headline: clip(narrative.team.headline, 60) || rules.team.headline,
      summary: clip(narrative.team.summary, 600) || rules.team.summary,
      phases: phases.length ? phases : rules.team.phases,
      alerts,
      recommendations: narrative.team.recommendations.length
        ? narrative.team.recommendations.slice(0, 4).map((s) => clip(s, 140))
        : rules.team.recommendations,
    },
    members,
  });
}

/** 모든 evidenceIds가 입력 이벤트 안에 있는지 (완료 기준 검사) */
export function invalidEvidence(report: AnalysisReport, input: AnalysisInput) {
  const ids = new Set(input.events.map((e) => e.id));
  const all = [
    ...report.team.alerts.flatMap((a) => a.evidenceIds),
    ...report.members.flatMap((m) => [...m.highlights.flatMap((h) => h.evidenceIds), ...m.flags.flatMap((f) => f.evidenceIds)]),
  ];
  return all.filter((id) => !ids.has(id));
}

// ---------------------------------------------------------------------------
// 3) Mock(예시 데이터) 입력 — 문서 변경 기록 + 회의 출석으로 같은 모양을 만든다
// ---------------------------------------------------------------------------
const letters = (s: string | null | undefined) => (s ? s.replace(/\s/g, "").length : 0);

export function inputFromActivities({
  team,
  members,
  activities,
  meetings,
  documents,
  period,
  now = Date.now(),
}: {
  team: AnalysisInput["team"];
  members: AnalysisInput["members"];
  activities: ContributionActivity[];
  meetings: Meeting[];
  documents: { id: string; name: string }[];
  period: AnalysisPeriodKey;
  now?: number;
}): AnalysisInput {
  const from = periodFromMs(period, now);
  const inRange = (iso: string) => from === null || Date.parse(iso) >= from;
  const ids = new Set(members.map((m) => m.id));
  const events: AnalysisEvent[] = activities
    .filter((a) => a.userId && ids.has(a.userId) && a.attributionStatus !== "unknown" && inRange(a.timestamp))
    .map((a) => {
      const added = letters(a.contentAfter);
      const removed = letters(a.contentBefore);
      const doc = documents.find((d) => d.id === a.documentId)?.name ?? "문서";
      return {
        id: a.id,
        userId: a.userId!,
        category: "document" as const,
        type: "external_doc_edit",
        points: Math.max(1, Math.round(Math.log2(1 + added + removed / 2))),
        createdAt: a.timestamp,
        attribution: a.attributionStatus === "verified" ? ("verified" as const) : ("inferred" as const),
        label: `${doc} · ${a.title}`,
        excerpt: (a.contentAfter ?? a.contentBefore ?? "").slice(0, 300) || undefined,
        added,
        removed,
      };
    });
  const scopedMeetings = meetings.filter((m) => inRange(m.heldAt));
  for (const m of scopedMeetings)
    for (const [userId, status] of Object.entries(m.attendance))
      if (ids.has(userId) && (status === "present" || status === "late"))
        events.push({
          id: `${m.id}:${userId}`,
          userId,
          category: "meeting",
          type: "meeting_attend",
          points: 1,
          createdAt: m.heldAt,
          attribution: "verified",
          label: `${m.title} ${status === "late" ? "지각" : "출석"}`,
        });
  const first = events.map((e) => e.createdAt).sort()[0] ?? null;
  return {
    version: 1,
    team,
    period: periodRange(period, now, first),
    members,
    events,
    meetings: scopedMeetings.map((m) => ({ id: m.id, title: m.title, heldAt: m.heldAt, attendance: m.attendance })),
    tasks: [],
  };
}
