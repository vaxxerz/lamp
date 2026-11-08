// 서버 전용: 이전/새 텍스트 비교로 기여 글자 수 계산 (공백·줄바꿈은 세지 않음)
import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();
const visible = (s: string) => s.replace(/\s/g, "").length;

export function countChanges(prev: string, next: string) {
  const diffs = dmp.diff_main(prev, next);
  dmp.diff_cleanupSemantic(diffs);
  let added = 0;
  let removed = 0;
  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_INSERT) added += visible(text);
    else if (op === DiffMatchPatch.DIFF_DELETE) removed += visible(text);
  }
  return { added, removed };
}

/** 바뀐 조각 1개. line은 1부터 (문서는 문단, 시트는 행) — 삭제는 이전 본문, 나머지는 새 본문 기준 */
export type ChangeFragment = {
  op: "insert" | "delete" | "replace";
  line: number;
  added?: string;
  removed?: string;
  before: string; // 앞 문맥
  after: string; // 뒤 문맥
};

export const MAX_FRAGMENTS = 30;
const FRAGMENT_TEXT = 200;
const CONTEXT = 30;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;
const oneLine = (s: string) => s.replace(/\s+/g, " ");

/** 글자 수 + 어디가 바뀌었는지 (공백만 바뀐 조각은 제외, 최대 MAX_FRAGMENTS개) */
export function diffWithFragments(prev: string, next: string) {
  const diffs = dmp.diff_main(prev, next);
  dmp.diff_cleanupSemantic(diffs);

  let added = 0;
  let removed = 0;
  let prevPos = 0;
  let nextPos = 0;
  let truncated = 0;
  const fragments: ChangeFragment[] = [];
  const push = (f: ChangeFragment) => {
    if (fragments.length < MAX_FRAGMENTS) fragments.push(f);
    else truncated++;
  };

  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i];
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      prevPos += text.length;
      nextPos += text.length;
      continue;
    }
    // 삭제 바로 뒤 추가 → 한 조각(replace)으로
    const del = op === DiffMatchPatch.DIFF_DELETE ? text : "";
    const ins =
      op === DiffMatchPatch.DIFF_INSERT ? text : diffs[i + 1]?.[0] === DiffMatchPatch.DIFF_INSERT ? diffs[++i][1] : "";
    removed += visible(del);
    added += visible(ins);

    if (visible(del) + visible(ins) > 0) {
      const base = ins ? next : prev;
      const pos = ins ? nextPos : prevPos;
      const len = ins ? ins.length : del.length;
      push({
        op: del && ins ? "replace" : ins ? "insert" : "delete",
        line: lineAt(base, pos),
        ...(ins ? { added: clip(ins.trim(), FRAGMENT_TEXT) } : {}),
        ...(del ? { removed: clip(del.trim(), FRAGMENT_TEXT) } : {}),
        before: oneLine(base.slice(Math.max(0, pos - CONTEXT), pos)).trimStart(),
        after: oneLine(base.slice(pos + len, pos + len + CONTEXT)).trimEnd(),
      });
    }
    prevPos += del.length;
    nextPos += ins.length;
  }
  return { added, removed, fragments, truncated };
}

/** 슬라이드별 텍스트 비교 → 변경/추가된 슬라이드 번호(1부터) */
export function diffSlides(prev: string[], next: string[]) {
  const slides_changed: number[] = [];
  const slides_added: number[] = [];
  next.forEach((text, i) => {
    if (i >= prev.length) slides_added.push(i + 1);
    else if (text.trim() !== prev[i].trim()) slides_changed.push(i + 1);
  });
  const slides_removed = prev.length > next.length ? prev.length - next.length : 0;
  return { slides_changed, slides_added, slides_removed };
}
