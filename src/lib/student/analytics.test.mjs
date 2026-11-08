// 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketWeeks, inPeriod, memberStats, weekRange, weekStart } from "./analytics.ts";

const p = (userId, at, points = 1, added = 0, removed = 0, category = "document") => ({ userId, at, points, added, removed, category });

test("주 시작은 한국 시간 월요일", () => {
  assert.equal(weekStart("2026-11-09T00:30:00+09:00"), "2026-11-09"); // 월요일 00:30 KST
  assert.equal(weekStart("2026-11-08T23:59:00+09:00"), "2026-11-02"); // 일요일 밤은 전 주
  assert.equal(weekStart("2026-11-08T15:30:00Z"), "2026-11-09"); // UTC 일요일 15:30 = KST 월요일 00:30
});

test("빈 주도 0으로 채우고 주별 합계", () => {
  const now = Date.parse("2026-11-20T12:00:00+09:00");
  const pts = [p("a", "2026-11-03T10:00:00+09:00", 2), p("b", "2026-11-04T10:00:00+09:00", 1), p("a", "2026-11-18T10:00:00+09:00", 3)];
  const weeks = weekRange(pts, "all", now);
  assert.deepEqual(weeks, ["2026-11-02", "2026-11-09", "2026-11-16"]);
  assert.deepEqual(
    bucketWeeks(pts, weeks).map((w) => [w.start, w.count, w.points]),
    [
      ["2026-11-02", 2, 3],
      ["2026-11-09", 0, 0],
      ["2026-11-16", 1, 3],
    ],
  );
});

test("기간 필터", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const pts = [p("a", "2026-06-01T00:00:00Z"), p("a", "2026-11-01T00:00:00Z")];
  assert.equal(inPeriod(pts, "1m", now).length, 1);
  assert.equal(inPeriod(pts, "all", now).length, 2);
});

test("팀원별 통계는 활동 수 순, 글자 · 카테고리 합계", () => {
  const pts = [
    p("a", "2026-11-03T00:00:00Z", 1, 10, 2),
    p("b", "2026-11-03T00:00:00Z", 1, 5, 0, "task"),
    p("b", "2026-11-04T00:00:00Z", 2, 7, 1, "meeting"),
  ];
  const stats = memberStats(pts, ["a", "b", "c"], ["2026-11-02"]);
  assert.deepEqual(
    stats.map((s) => [s.userId, s.count, s.added, s.removed]),
    [
      ["b", 2, 12, 1],
      ["a", 1, 10, 2],
      ["c", 0, 0, 0],
    ],
  );
  assert.deepEqual(stats[0].byCategory, { document: 0, task: 1, meeting: 1, file: 0 });
});
