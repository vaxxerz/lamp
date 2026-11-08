// 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdit, computeBlame, overlaySuggestions, toSegments } from "./blame.ts";

const owners = (text, runs) => toSegments(runs).map((s) => [text.slice(s.start, s.end), s.src]);

test("기준선은 기록 이전, 이후 삽입은 그 구간", () => {
  const runs = computeBlame(
    [
      { at: 1, text: "서론입니다.", src: null },
      { at: 2, text: "서론입니다. 본론은 A가 씀.", src: "r:a" },
    ],
    "서론입니다. 본론은 A가 씀.",
  );
  assert.deepEqual(owners("서론입니다. 본론은 A가 씀.", runs), [
    ["서론입니다.", null],
    [" 본론은 A가 씀.", "r:a"],
  ]);
});

test("지운 글자는 사라지고 가운데 삽입은 앞뒤 출처를 유지", () => {
  const t1 = "AAAA BBBB";
  const r1 = applyEdit("", [], t1, "r:1");
  const t2 = "AAAA CC BBBB";
  const r2 = applyEdit(t1, r1, t2, "r:2");
  assert.deepEqual(owners(t2, r2), [
    ["AAAA ", "r:1"],
    ["CC ", "r:2"],
    ["BBBB", "r:1"],
  ]);
  const t3 = "CC BBBB";
  assert.deepEqual(owners(t3, applyEdit(t2, r2, t3, "r:3")), [
    ["CC ", "r:2"],
    ["BBBB", "r:1"],
  ]);
});

test("시간 순서로 정렬해서 적용 (기록 순서와 무관)", () => {
  const runs = computeBlame(
    [
      { at: 3, text: "hello world!", src: "r:b" },
      { at: 1, text: "hello", src: "r:a" },
    ],
    "hello world!",
  );
  assert.deepEqual(owners("hello world!", runs), [
    ["hello", "r:a"],
    [" world!", "r:b"],
  ]);
});

test("구간 안의 제안 글자는 제안 작성자로", () => {
  const text = "앞 문장. 제안으로 쓴 문장. 직접 쓴 문장.";
  const runs = overlaySuggestions(text, [{ len: text.length, src: "r:x" }], "r:x", [
    { id: "s1", text: "제안으로 쓴 문장." },
  ]);
  assert.deepEqual(owners(text, runs), [
    ["앞 문장. ", "r:x"],
    ["제안으로 쓴 문장.", "s:s1"],
    [" 직접 쓴 문장.", "r:x"],
  ]);
});

test("기준선 본문 안의 (기준선 이전) 제안 글자도 제안 작성자로", () => {
  const base = "연결 전 본문. 제안으로 쓴 문장.";
  const runs = computeBlame([{ at: 1, text: base, src: null, suggestions: [{ id: "s0", text: "제안으로 쓴 문장." }] }], base);
  assert.deepEqual(owners(base, runs), [
    ["연결 전 본문. ", null],
    ["제안으로 쓴 문장.", "s:s0"],
  ]);
});

test("마지막 본문과 다르면 차이는 기록 이전", () => {
  const runs = computeBlame([{ at: 1, text: "abc", src: "r:a" }], "abc def");
  assert.deepEqual(owners("abc def", runs), [
    ["abc", "r:a"],
    [" def", null],
  ]);
});
