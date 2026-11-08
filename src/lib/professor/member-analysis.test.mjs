import assert from "node:assert/strict";
import { test } from "node:test";
import { professorMock } from "./mock-data.ts";
import { analyzeTeam, changeSize } from "./member-analysis.ts";

const NOW = Date.parse("2026-11-08T00:00:00Z");

test("미확인 기록은 개인에게 붙이지 않고 비중 합은 1", () => {
  const a = analyzeTeam(professorMock, "t1", { now: NOW });
  const acts = professorMock.activities.filter((x) => x.teamId === "t1");
  assert.equal(a.total, acts.length);
  assert.equal(
    a.members.reduce((n, m) => n + m.count, 0),
    acts.filter((x) => x.attributionStatus !== "unknown").length,
  );
  const sum = a.members.reduce((n, m) => n + m.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("기간 밖 기록은 빠지고 쉰 기간을 알려준다", () => {
  const later = NOW + 40 * 86_400_000;
  const a = analyzeTeam(professorMock, "t1", { now: later, period: "1m" });
  assert.equal(a.total, 0);
  assert.ok(a.members.every((m) => m.notes.some((n) => n.includes("일째 변경 없음"))));
  assert.ok(a.notes.some((n) => n.startsWith("변경 없는 팀원")));
});

test("공동 편집은 편집 비율로 변경량을 나누고 쏠림을 알린다", () => {
  const data = structuredClone(professorMock);
  data.activities = [
    {
      ...data.activities[0],
      id: "x",
      userId: "u1",
      attributionStatus: "inferred",
      title: "서비스 기획서 직접 수정 (+900 / −100자)",
      shares: [
        { userId: "u1", name: "김지민", share: 0.75 },
        { userId: "u2", name: "박서연", share: 0.25 },
      ],
    },
  ];
  const a = analyzeTeam(data, "t1", { now: NOW });
  const by = Object.fromEntries(a.members.map((m) => [m.userId, m]));
  assert.equal(by.u1.added, 675);
  assert.equal(by.u2.added, 225);
  assert.equal(by.u3.share, 0);
  assert.ok(by.u1.notes.includes("변경량 쏠림"));
  assert.ok(by.u3.notes.includes("기록된 변경 없음"));
});

test("결석은 체크된 회의만 센다", () => {
  const a = analyzeTeam(professorMock, "t2", { now: NOW });
  const u5 = a.members.find((m) => m.userId === "u5");
  const u4 = a.members.find((m) => m.userId === "u4");
  assert.equal(u5.attendance.absent, 1);
  assert.equal(u4.attendance.checked, 0);
});

test("직접 수정 제목에서 글자 수를 읽는다", () => {
  assert.deepEqual(
    changeSize({ title: "기획서 직접 수정 (+12 / −3자)", contentAfter: null, contentBefore: null }),
    { added: 12, removed: 3 },
  );
});

test("활동 구성은 선택한 팀·학생·기간의 실제 카테고리만 집계한다", () => {
  // Given events across teams, users, periods, and categories.
  const data = structuredClone(professorMock);
  const event = (category, extra = {}) => ({ teamId: 't1', userId: 'u1', category, createdAt: '2026-11-07T00:00:00Z', ...extra });
  data.events = [event('document'), event('task'), event('task'), event('file'), event('meeting'),
    event('file', { teamId: 't2' }), event('file', { userId: 'u2' }), event('file', { createdAt: '2026-01-01T00:00:00Z' })];
  // When viewing the recent month for one team.
  const analysis = analyzeTeam(data, 't1', { now: NOW, period: '1m' });
  // Then only that member's five in-range events form the displayed ratio.
  assert.deepEqual(analysis.members.find(member => member.userId === 'u1').byCategory, { document: 1, task: 2, meeting: 1, file: 1 });
});
