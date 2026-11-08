// 문서 미리보기 + 통계: DB 행 → 형광펜 구간 · 편집자별 통계 (순수 함수, 서버에서 실행)
import { computeBlame, toSegments, visibleLength, type BlameStep, type Source } from "./blame";

type Named = { name: string } | null;

export type RevisionRow = {
  id: string;
  modified_at: string;
  period_start: string | null;
  source: "revision" | "snapshot";
  text_after: string | null;
  chars_added: number;
  chars_removed: number;
  google_display_name: string | null;
  author_id: string | null;
  author: Named;
  credits: {
    author_id: string | null;
    display_name: string | null;
    share: number;
    confidence: "single" | "shared" | "fallback";
    chars_added: number;
    chars_removed: number;
    author: Named;
  }[];
};

export type SuggestionRow = {
  id: string;
  added_text: string;
  chars_added: number;
  chars_removed: number;
  accepted_at: string;
  author_id: string | null;
  author_name: string | null;
  author: Named;
};

export type DocRow = {
  id: string;
  title: string;
  mime_type: string;
  web_url: string | null;
  last_synced_at: string | null;
  snapshot_text: string | null;
  last_text: string;
  blame_base_text: string | null;
  blame_base_at: string | null;
};

export type Confidence = "confirmed" | "single" | "shared" | "fallback";

export type InsightAuthor = { key: string; name: string; connected: boolean };
export type InsightSource = {
  kind: "revision" | "suggestion";
  at: string;
  from: string | null;
  confidence: Confidence;
  /** authors 배열 인덱스 + 비율 (합 1) */
  authors: { a: number; share: number }[];
};
export type AuthorStats = {
  a: number;
  /** 현재 본문에 남아 있는 글자 (공동 구간은 비율로 나눈 추정, 공백 제외) */
  current: number;
  currentShare: number;
  added: number;
  removed: number;
  edits: number;
  lastAt: string | null;
  paragraphsLed: number;
  /** 쓴 글자 중 지금까지 남은 비율 (0~1, 기록 이후 기준) */
  survival: number | null;
};
export type DocInsight = {
  doc: { id: string; title: string; mime_type: string; web_url: string | null; last_synced_at: string | null };
  text: string;
  authors: InsightAuthor[];
  sources: Record<string, InsightSource>;
  segments: { start: number; end: number; src: Source }[];
  stats: {
    chars: number;
    words: number;
    paragraphs: number;
    edits: number;
    suggestions: number;
    coverage: { confirmed: number; estimated: number; unknown: number };
    perAuthor: AuthorStats[];
    daily: { day: string; byAuthor: number[] }[];
    trackedSince: string | null;
  };
};

const DAYS = 14;
const dayOf = (iso: string | number) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

export function buildInsight(
  doc: DocRow,
  revisions: RevisionRow[],
  suggestions: SuggestionRow[],
  now = Date.now(),
): DocInsight {
  const text = doc.snapshot_text ?? doc.last_text ?? "";

  // ---------- 편집자 ----------
  const authors: InsightAuthor[] = [];
  const index = new Map<string, number>();
  const authorOf = (id: string | null, profile: Named, googleName: string | null) => {
    const key = id ?? `g:${googleName ?? "?"}`;
    let i = index.get(key);
    if (i === undefined) {
      i = authors.length;
      index.set(key, i);
      authors.push({ key, name: profile?.name ?? `${googleName ?? "알 수 없음"} (미연결)`, connected: !!id });
    }
    return i;
  };

  // ---------- 출처 ----------
  const sources: Record<string, InsightSource> = {};
  for (const r of revisions) {
    const credits = r.credits.length
      ? r.credits.map((c) => ({
          a: authorOf(c.author_id, c.author, c.display_name ?? r.google_display_name),
          share: Number(c.share),
          confidence: c.confidence,
          added: c.chars_added,
          removed: c.chars_removed,
        }))
      : [
          {
            a: authorOf(r.author_id, r.author, r.google_display_name),
            share: 1,
            confidence: "fallback" as const,
            added: r.chars_added,
            removed: r.chars_removed,
          },
        ];
    const confidence: Confidence =
      credits.length > 1 ? "shared" : credits[0].confidence === "fallback" ? "fallback" : "single";
    sources[`r:${r.id}`] = {
      kind: "revision",
      at: r.modified_at,
      from: r.period_start,
      confidence,
      authors: credits.map(({ a, share }) => ({ a, share })),
    };
  }
  for (const s of suggestions) {
    sources[`s:${s.id}`] = {
      kind: "suggestion",
      at: s.accepted_at,
      from: null,
      confidence: "confirmed",
      authors: [{ a: authorOf(s.author_id, s.author, s.author_name), share: 1 }],
    };
  }

  // ---------- 형광펜 ----------
  const steps: BlameStep[] = [];
  if (doc.blame_base_text !== null && doc.blame_base_at) {
    const baseAt = Date.parse(doc.blame_base_at);
    steps.push({
      at: baseAt,
      text: doc.blame_base_text,
      src: null,
      // 기준선 이전에 수락된 제안 → 기준선 본문에서 일치하는 부분을 제안 작성자로
      suggestions: suggestions
        .filter((s) => s.added_text && Date.parse(s.accepted_at) <= baseAt)
        .map((s) => ({ id: s.id, text: s.added_text })),
    });
  }
  for (const r of revisions) {
    if (r.text_after === null) continue;
    const end = Date.parse(r.modified_at);
    const start = r.period_start ? Date.parse(r.period_start) : -Infinity;
    steps.push({
      at: end,
      text: r.text_after,
      src: `r:${r.id}`,
      suggestions:
        r.source === "snapshot"
          ? suggestions
              .filter((s) => {
                const t = Date.parse(s.accepted_at);
                return t > start && t <= end && s.added_text;
              })
              .map((s) => ({ id: s.id, text: s.added_text }))
          : undefined,
    });
  }
  const segments = toSegments(computeBlame(steps, text)).filter((s) => s.end > s.start);

  // ---------- 통계 ----------
  const n = authors.length;
  const current = new Array<number>(n).fill(0);
  const coverage = { confirmed: 0, estimated: 0, unknown: 0 };
  const addTo = (arr: number[], src: Source, chars: number) => {
    const s = src ? sources[src] : undefined;
    if (!s) return false;
    for (const { a, share } of s.authors) arr[a] += chars * share;
    return true;
  };
  for (const seg of segments) {
    const chars = visibleLength(text.slice(seg.start, seg.end));
    if (!chars) continue;
    const s = seg.src ? sources[seg.src] : undefined;
    if (!s) coverage.unknown += chars;
    else if (s.confidence === "confirmed" || s.confidence === "single") coverage.confirmed += chars;
    else coverage.estimated += chars;
    addTo(current, seg.src, chars);
  }

  // 문단별 주도한 사람
  const led = new Array<number>(n).fill(0);
  let paragraphs = 0;
  let pos = 0;
  let si = 0;
  for (const line of text.split("\n")) {
    const lineEnd = pos + line.length;
    if (visibleLength(line) > 0) {
      paragraphs++;
      const share = new Array<number>(n).fill(0);
      while (si < segments.length && segments[si].end <= pos) si++;
      for (let k = si; k < segments.length && segments[k].start < lineEnd; k++) {
        const seg = segments[k];
        addTo(share, seg.src, visibleLength(text.slice(Math.max(seg.start, pos), Math.min(seg.end, lineEnd))));
      }
      const top = share.reduce((best, v, i) => (v > (share[best] ?? 0) ? i : best), -1);
      if (top >= 0 && share[top] > 0) led[top]++;
    }
    pos = lineEnd + 1;
  }

  // 기록 이력: 글자 수 · 횟수 · 마지막 수정 · 일별
  const added = new Array<number>(n).fill(0);
  const addedTracked = new Array<number>(n).fill(0);
  const removed = new Array<number>(n).fill(0);
  const edits = new Array<number>(n).fill(0);
  const lastAt: (string | null)[] = new Array(n).fill(null);
  const days = Array.from({ length: DAYS }, (_, i) => dayOf(now - (DAYS - 1 - i) * 86_400_000));
  const daily = days.map((day) => ({ day, byAuthor: new Array<number>(n).fill(0) }));
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const record = (a: number, at: string, add: number, rem: number, tracked: boolean) => {
    added[a] += add;
    removed[a] += rem;
    if (tracked) addedTracked[a] += add;
    edits[a]++;
    if (!lastAt[a] || at > lastAt[a]!) lastAt[a] = at;
    const d = dayIndex.get(dayOf(at));
    if (d !== undefined) daily[d].byAuthor[a] += add;
  };
  const baseAt = doc.blame_base_at ? Date.parse(doc.blame_base_at) : null;
  for (const r of revisions) {
    const tracked = r.text_after !== null; // 본문이 남은 구간만 생존율 분모에
    const src = sources[`r:${r.id}`];
    const credits = r.credits.length ? r.credits : null;
    src.authors.forEach(({ a }, i) =>
      record(a, r.modified_at, credits?.[i].chars_added ?? r.chars_added, credits?.[i].chars_removed ?? r.chars_removed, tracked),
    );
  }
  for (const s of suggestions) {
    record(sources[`s:${s.id}`].authors[0].a, s.accepted_at, s.chars_added, s.chars_removed, true);
  }

  const total = coverage.confirmed + coverage.estimated + coverage.unknown;
  const perAuthor: AuthorStats[] = authors
    .map((_, a) => ({
      a,
      current: Math.round(current[a]),
      currentShare: total ? current[a] / total : 0,
      added: added[a],
      removed: removed[a],
      edits: edits[a],
      lastAt: lastAt[a],
      paragraphsLed: led[a],
      survival: addedTracked[a] > 0 ? Math.min(1, current[a] / addedTracked[a]) : null,
    }))
    .sort((x, y) => y.current - x.current || y.added - x.added);

  const firstTracked = steps.filter((s) => s.src).map((s) => s.at).sort((a, b) => a - b)[0];
  return {
    doc: {
      id: doc.id,
      title: doc.title,
      mime_type: doc.mime_type,
      web_url: doc.web_url,
      last_synced_at: doc.last_synced_at,
    },
    text,
    authors,
    sources,
    segments,
    stats: {
      chars: total,
      words: text.split(/\s+/).filter(Boolean).length,
      paragraphs,
      edits: revisions.length,
      suggestions: suggestions.length,
      coverage,
      perAuthor,
      daily,
      trackedSince: baseAt ? new Date(baseAt).toISOString() : firstTracked ? new Date(firstTracked).toISOString() : null,
    },
  };
}
