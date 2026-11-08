// 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRulesReport, classifyPattern, gini, invalidEvidence, longestGap, mergeNarrative, promptPayload } from "./rules.ts";

const NOW = Date.parse("2026-11-08T12:00:00+09:00");
const ev = (id, userId, at, extra = {}) => ({
  id,
  userId,
  category: "document",
  type: "external_doc_edit",
  points: 2,
  createdAt: at,
  attribution: "verified",
  label: `기록 ${id}`,
  added: 10,
  removed: 0,
  ...extra,
});
const input = (events, members = ["a", "b", "c"]) => ({
  version: 1,
  team: { id: "t1", name: "A팀", track: "class" },
  period: { key: "1m", from: "2026-10-09", to: "2026-11-08" },
  members: members.map((id) => ({ id, name: id.toUpperCase() })),
  events,
  meetings: [],
  tasks: [],
});

test("활동 0건 팀원도 members에 들어가고 inactive + free_rider critical", () => {
  const r = buildRulesReport(input([ev("1", "a", "2026-10-20T10:00:00Z"), ev("2", "b", "2026-10-27T10:00:00Z")]), { now: NOW });
  const c = r.members.find((m) => m.userId === "c");
  assert.equal(r.members.length, 3);
  assert.equal(c.pattern, "inactive");
  assert.ok(c.flags.some((f) => f.type === "free_rider" && f.severity === "critical"));
  assert.equal(r.model, "rules-v1");
});

test("한 주에 몰리면 burst, 최근 7일에 몰리면 late", () => {
  const weeks = [
    { start: "2026-10-12", count: 0 },
    { start: "2026-10-19", count: 5 },
    { start: "2026-10-26", count: 0 },
    { start: "2026-11-02", count: 0 },
  ];
  const burst = Array.from({ length: 5 }, (_, i) => ev(`${i}`, "a", "2026-10-20T10:00:00Z"));
  assert.equal(classifyPattern(burst, weeks, NOW).pattern, "burst");
  const late = Array.from({ length: 5 }, (_, i) => ev(`${i}`, "a", "2026-11-06T10:00:00Z"));
  assert.equal(classifyPattern(late, weeks, NOW).pattern, "late");
});

test("중간 공백 주 수 · 지니 계수", () => {
  assert.deepEqual(
    longestGap([
      { start: "w1", count: 1 },
      { start: "w2", count: 0 },
      { start: "w3", count: 0 },
      { start: "w4", count: 2 },
      { start: "w5", count: 0 },
    ]),
    { length: 2, from: "w2" },
  );
  assert.equal(gini([5, 5, 5]), 0);
  assert.ok(gini([10, 0, 0]) > 0.6);
});

test("추정 기록만 근거인 하이라이트에는 (추정)이 붙는다", () => {
  const r = buildRulesReport(input([ev("1", "a", "2026-10-20T10:00:00Z", { attribution: "inferred" })]), { now: NOW });
  assert.match(r.members[0].highlights[0].label, /\(추정\)$/);
});

test("AI 문장 합치기: 없는 근거 · 다른 사람 근거는 버리고 숫자는 규칙 값 유지", () => {
  const inp = input([ev("x1", "a", "2026-10-20T10:00:00Z"), ev("x2", "b", "2026-10-21T10:00:00Z")]);
  const rules = buildRulesReport(inp, { audience: "student", now: NOW });
  const { refToId, memberRef } = promptPayload(inp, rules);
  const refA = [...refToId].find(([, id]) => id === "x1")[0];
  const refB = [...refToId].find(([, id]) => id === "x2")[0];
  const merged = mergeNarrative(
    rules,
    {
      team: { headline: "좋은 출발", summary: "요약", phases: [], recommendations: ["제안"], alertMessages: [] },
      members: [
        {
          ref: memberRef.get("a"),
          role: "작성",
          summary: "A님 요약",
          highlights: [
            { label: "서론", evidence: [refA, "e999"] },
            { label: "남의 것", evidence: [refB] },
          ],
          strengths: [],
          suggestions: ["다음 행동"],
          questions: ["학생용엔 버려짐"],
        },
      ],
    },
    refToId,
    memberRef,
    inp,
    "claude-test",
  );
  const a = merged.members.find((m) => m.userId === "a");
  assert.deepEqual(a.highlights, [{ label: "서론", evidenceIds: ["x1"] }]);
  assert.deepEqual(a.questions, []);
  assert.equal(a.metrics.events, 1);
  assert.equal(merged.aiStatus, "ok");
  assert.equal(merged.model, "rules-v1 + claude-test");
  assert.deepEqual(invalidEvidence(merged, inp), []);
});
