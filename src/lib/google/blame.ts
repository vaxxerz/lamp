// 미리보기 형광펜: 현재 본문의 글자마다 "어느 구간(→ 편집자) · 어느 제안에서 왔는지" 계산 — 순수 함수
//
//  1) 구간 끝 본문(text_after)과 기준선(blame_base_text)을 시간 순서로 늘어놓고
//  2) 직전 본문 → 다음 본문 diff: 같은 글자는 출처 유지, 새 글자는 그 구간이 출처, 지운 글자는 사라짐
//  3) 구간 안에서 수락된 제안의 글자는 제안 작성자(확인)로 덮어씀
//  4) 마지막으로 현재 본문과 맞춤 (공백만 바뀐 경우 등은 "기록 이전")
//  출처를 구간 id로 남기므로 배분(credits)이 나중에 바뀌어도 읽을 때 반영된다.
import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();
dmp.Diff_Timeout = 0.5;

/** "r:<revision id>" | "s:<suggestion id>" | null(기록 이전) */
export type Source = string | null;
export type Run = { len: number; src: Source };

export type BlameStep = {
  at: number; // ms
  text: string;
  src: Source;
  /** 이 구간 안에서 수락된 제안 (삽입된 글자 중 일치하는 부분을 제안 작성자로) */
  suggestions?: { id: string; text: string }[];
};

function push(runs: Run[], len: number, src: Source) {
  if (len <= 0) return;
  const last = runs.at(-1);
  if (last && last.src === src) last.len += len;
  else runs.push({ len, src });
}

/** runs에서 [from, from+len) 구간을 out에 복사 */
function copyRange(runs: Run[], from: number, len: number, out: Run[]) {
  let pos = 0;
  for (const r of runs) {
    if (len <= 0) break;
    const end = pos + r.len;
    if (end > from) {
      const s = Math.max(from, pos);
      const take = Math.min(end, from + len) - s;
      push(out, take, r.src);
      from += take;
      len -= take;
    }
    pos = end;
  }
  if (len > 0) push(out, len, null); // 길이 불일치 방어
}

/** prev 본문(runs) → next 본문: 새 글자는 src */
export function applyEdit(prevText: string, prevRuns: Run[], nextText: string, src: Source): Run[] {
  if (prevText === nextText) return prevRuns;
  const diffs = dmp.diff_main(prevText, nextText);
  dmp.diff_cleanupSemantic(diffs);
  const out: Run[] = [];
  let p = 0;
  for (const [op, t] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      copyRange(prevRuns, p, t.length, out);
      p += t.length;
    } else if (op === DiffMatchPatch.DIFF_DELETE) {
      p += t.length;
    } else {
      push(out, t.length, src);
    }
  }
  return out;
}

/** 이번 구간에서 새로 들어온(src) 글자 중 제안 본문과 같은 부분을 제안 출처로 */
export function overlaySuggestions(text: string, runs: Run[], src: Source, suggestions: { id: string; text: string }[]) {
  const wanted = suggestions.map((s) => ({ id: s.id, text: s.text.trim() })).filter((s) => s.text.length >= 2);
  if (!wanted.length) return runs;
  const owner: Source[] = [];
  for (const r of runs) for (let i = 0; i < r.len; i++) owner.push(r.src);
  for (const s of wanted) {
    // 이번 구간 글자 안에서 처음 일치하는 위치 하나만
    for (let from = 0; ; ) {
      const at = text.indexOf(s.text, from);
      if (at < 0) break;
      let fresh = true;
      for (let i = at; i < at + s.text.length; i++) if (owner[i] !== src) fresh = false;
      if (fresh) {
        for (let i = at; i < at + s.text.length; i++) owner[i] = `s:${s.id}`;
        break;
      }
      from = at + 1;
    }
  }
  const out: Run[] = [];
  for (const o of owner) push(out, 1, o);
  return out;
}

export function computeBlame(steps: BlameStep[], currentText: string): Run[] {
  const ordered = [...steps].sort((a, b) => a.at - b.at || (a.src === null ? 1 : 0) - (b.src === null ? 1 : 0));
  let text = "";
  let runs: Run[] = [];
  for (const step of ordered) {
    runs = applyEdit(text, runs, step.text, step.src);
    // 기준선(src null)에도 적용: 연결 전에 수락된 제안은 작성자가 확실하므로 칠한다
    if (step.suggestions?.length) runs = overlaySuggestions(step.text, runs, step.src, step.suggestions);
    text = step.text;
  }
  return applyEdit(text, runs, currentText, null);
}

/** 연속 runs → [start, end) 구간 */
export function toSegments(runs: Run[]) {
  const out: { start: number; end: number; src: Source }[] = [];
  let pos = 0;
  for (const r of runs) {
    out.push({ start: pos, end: pos + r.len, src: r.src });
    pos += r.len;
  }
  return out;
}

export const visibleLength = (s: string) => s.replace(/\s/g, "").length;
