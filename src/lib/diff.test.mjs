// 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { diffWithFragments, MAX_FRAGMENTS } from "./diff.ts";

test("추가 · 삭제 · 교체를 줄 번호와 문맥으로", () => {
  const prev = "1장 서론\n시장 규모는 크다.\n결론";
  const next = "1장 서론\n시장 규모는 3조 원으로 크다.\n경쟁사 분석 추가\n결론";
  const { added, fragments } = diffWithFragments(prev, next);
  assert.ok(added > 0);
  assert.equal(fragments[0].line, 2);
  assert.match(fragments[0].added, /3조/);
  assert.match(fragments[0].before, /시장 규모는/);
  assert.ok(fragments.some((f) => f.added?.includes("경쟁사 분석")));
});

test("삭제는 이전 본문 기준 줄 번호", () => {
  const { fragments, removed } = diffWithFragments("가\n나\n지울 문장입니다\n라", "가\n나\n라");
  assert.ok(removed > 0);
  assert.equal(fragments[0].op, "delete");
  assert.equal(fragments[0].line, 3);
  assert.match(fragments[0].removed, /지울 문장/);
});

test("삭제 뒤 추가는 replace 한 조각", () => {
  const { fragments } = diffWithFragments("예산은 100만원이다", "예산은 250만원이다");
  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].op, "replace");
  assert.ok(fragments[0].added && fragments[0].removed);
});

test("공백만 바뀐 조각은 제외", () => {
  const r = diffWithFragments("가 나 다", "가  나 다 ");
  assert.deepEqual([r.added, r.removed, r.fragments.length], [0, 0, 0]);
});

test("조각 수 제한", () => {
  const prev = Array.from({ length: 50 }, (_, i) => `${i}번 문단은 그대로 유지되는 꽤 긴 문장입니다.`).join("\n");
  const next = Array.from({ length: 50 }, (_, i) => `${i}번 문단은 그대로 유지되는 꽤 긴 문장입니다. 추가`).join("\n");
  const r = diffWithFragments(prev, next);
  assert.equal(r.fragments.length, MAX_FRAGMENTS);
  assert.equal(r.truncated, 50 - MAX_FRAGMENTS);
});
