// 구간(스냅샷 · revision)의 diff를 편집자별로 나누는 순수 함수 — DB·네트워크 의존 없음
//
//  1) 구간 (start, end]과 겹치는 편집 이벤트만, 구간 밖은 잘라냄
//  2) 시각만 있는 이벤트(start === end)는 직전 INSTANT_EDIT_MS 동안 편집한 것으로 간주
//  3) 같은 사람의 겹치는 이벤트는 합집합으로 (중복 계산 방지)
//  4) 편집자 1명 → 100% (single), 여러 명 → 편집 시간 비율 (shared, 최소 MIN_SHARE 보장)
//  5) 글자 수는 최대 잔여법으로 나눠 합계가 정확히 맞게
//  편집자가 없으면 null → DB가 lastModifyingUser 1명에게 전부 (fallback)

export const INSTANT_EDIT_MS = 30_000;
export const MIN_SHARE = 0.1;

export type EditSpanLike = { personId: string; start: number; end: number };
export type Period = { start: number | null; end: number }; // ms, start null = 처음부터

export type Credit = {
  person_id: string;
  permission_id: null;
  display_name: null;
  chars_added: number;
  chars_removed: number;
  share: number;
  confidence: "single" | "shared";
  /** 이 구간에서 이 사람이 편집한 시간대 (Activity 기준, ISO) */
  edited_from: string;
  edited_to: string;
};

type PersonEdits = { total: number; from: number; to: number };

/** 사람별로 구간과 겹친 편집 시간(ms) */
export function editTimeByPerson(spans: EditSpanLike[], period: Period): Map<string, number> {
  return new Map([...editsByPerson(spans, period)].map(([p, e]) => [p, e.total]));
}

/** 사람별 편집 시간 합계 + 처음 · 마지막 편집 시각 */
export function editsByPerson(spans: EditSpanLike[], period: Period): Map<string, PersonEdits> {
  const lo = period.start ?? -Infinity;
  const byPerson = new Map<string, [number, number][]>();
  for (const span of spans) {
    const start = Math.max(span.start === span.end ? span.end - INSTANT_EDIT_MS : span.start, lo);
    const end = Math.min(span.end, period.end);
    if (end <= start || span.end <= lo) continue;
    const list = byPerson.get(span.personId) ?? [];
    list.push([start, end]);
    byPerson.set(span.personId, list);
  }

  const result = new Map<string, PersonEdits>();
  for (const [person, intervals] of byPerson) {
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [curStart, curEnd] = intervals[0];
    for (const [s, e] of intervals.slice(1)) {
      if (s <= curEnd) curEnd = Math.max(curEnd, e);
      else {
        total += curEnd - curStart;
        [curStart, curEnd] = [s, e];
      }
    }
    result.set(person, {
      total: total + (curEnd - curStart),
      from: intervals[0][0],
      to: Math.max(...intervals.map(([, e]) => e)),
    });
  }
  return result;
}

/** total을 비율대로 정수 분배 (합계 보존, 최대 잔여법) */
export function allocate(total: number, shares: number[]): number[] {
  const exact = shares.map((s) => s * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

/** 시간 비율, 단 MIN_SHARE 미만은 MIN_SHARE로 고정하고 나머지를 다른 사람끼리 비율대로 */
export function sharesWithMinimum(weights: number[]): number[] {
  if (weights.length * MIN_SHARE >= 1) return weights.map(() => 1 / weights.length);
  const fixed = new Set<number>();
  for (;;) {
    const freeWeight = weights.reduce((n, w, i) => (fixed.has(i) ? n : n + w), 0);
    const freeShare = 1 - fixed.size * MIN_SHARE;
    const shares = weights.map((w, i) => (fixed.has(i) ? MIN_SHARE : (w / freeWeight) * freeShare));
    const below = shares.findIndex((s, i) => !fixed.has(i) && s < MIN_SHARE);
    if (below === -1) return shares;
    fixed.add(below);
  }
}

export function attribute(
  period: Period,
  spans: EditSpanLike[],
  changes: { added: number; removed: number },
): Credit[] | null {
  const edits = editsByPerson(spans, period);
  const times = [...edits]
    .map(([person, e]) => [person, e.total] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (times.length === 0) return null;
  const window = (person: string) => ({
    edited_from: new Date(edits.get(person)!.from).toISOString(),
    edited_to: new Date(edits.get(person)!.to).toISOString(),
  });
  if (times.length === 1) {
    return [
      {
        person_id: times[0][0],
        permission_id: null,
        display_name: null,
        chars_added: changes.added,
        chars_removed: changes.removed,
        share: 1,
        confidence: "single",
        ...window(times[0][0]),
      },
    ];
  }

  const shares = sharesWithMinimum(times.map(([, t]) => t));
  const added = allocate(changes.added, shares);
  const removed = allocate(changes.removed, shares);
  return times.map(([person], i) => ({
    person_id: person,
    permission_id: null,
    display_name: null,
    chars_added: added[i],
    chars_removed: removed[i],
    share: Math.round(shares[i] * 10_000) / 10_000,
    confidence: "shared",
    ...window(person),
  }));
}
