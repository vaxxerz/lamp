// 실행: npm run test:unit  (Node 22.18+ 의 TypeScript 타입 제거로 .ts를 바로 import)
import assert from "node:assert/strict";
import { test } from "node:test";
import { allocate, attribute, editTimeByPerson, INSTANT_EDIT_MS } from "./attribute.ts";

const t = (hms) => Date.parse(`2026-11-07T${hms}Z`);
const period = { start: t("14:00:00"), end: t("14:02:00") };

test("편집자 1명이면 100% single", () => {
  const credits = attribute(period, [{ personId: "A", start: t("14:00:30"), end: t("14:01:00") }], {
    added: 300,
    removed: 40,
  });
  assert.deepEqual(credits?.map((c) => [c.person_id, c.chars_added, c.chars_removed, c.share, c.confidence]), [
    ["A", 300, 40, 1, "single"],
  ]);
});

test("여러 명이면 편집 시간 비율로 나누고 합계 보존 (A 80초, B 50초)", () => {
  const credits = attribute(
    period,
    [
      { personId: "A", start: t("14:00:10"), end: t("14:01:30") },
      { personId: "B", start: t("14:01:00"), end: t("14:01:50") },
    ],
    { added: 300, removed: 40 },
  );
  assert.equal(credits.length, 2);
  const [a, b] = credits;
  assert.equal(a.person_id, "A");
  assert.equal(a.confidence, "shared");
  assert.equal(a.chars_added + b.chars_added, 300);
  assert.equal(a.chars_removed + b.chars_removed, 40);
  assert.deepEqual([a.chars_added, b.chars_added], [185, 115]);
  assert.deepEqual([a.chars_removed, b.chars_removed], [25, 15]);
});

test("구간 밖 편집은 잘라내고, 구간과 안 겹치면 제외", () => {
  const times = editTimeByPerson(
    [
      { personId: "A", start: t("13:59:00"), end: t("14:01:00") }, // 앞 1분만 잘림 → 60초
      { personId: "B", start: t("13:50:00"), end: t("13:55:00") }, // 구간 밖
      { personId: "C", start: t("14:03:00"), end: t("14:04:00") }, // 구간 밖
    ],
    period,
  );
  assert.deepEqual([...times], [["A", 60_000]]);
});

test("같은 사람의 겹치는 이벤트는 한 번만 계산", () => {
  const times = editTimeByPerson(
    [
      { personId: "A", start: t("14:00:00"), end: t("14:01:00") },
      { personId: "A", start: t("14:00:30"), end: t("14:01:30") },
      { personId: "A", start: t("14:01:40"), end: t("14:01:50") },
    ],
    period,
  );
  assert.equal(times.get("A"), 100_000);
});

test("시각만 있는 이벤트는 직전 30초 편집으로 간주", () => {
  const times = editTimeByPerson([{ personId: "A", start: t("14:01:00"), end: t("14:01:00") }], period);
  assert.equal(times.get("A"), INSTANT_EDIT_MS);
});

test("구간 시작 시각과 같은 이벤트는 이전 구간 몫", () => {
  assert.equal(attribute(period, [{ personId: "A", start: t("14:00:00"), end: t("14:00:00") }], { added: 10, removed: 0 }), null);
});

test("잠깐 손댄 사람도 최소 10%", () => {
  const credits = attribute(
    period,
    [
      { personId: "A", start: t("14:00:00"), end: t("14:01:59") },
      { personId: "B", start: t("14:01:59"), end: t("14:02:00") },
    ],
    { added: 100, removed: 0 },
  );
  assert.deepEqual(
    credits.map((c) => [c.person_id, c.chars_added]),
    [
      ["A", 90],
      ["B", 10],
    ],
  );
});

test("편집 이벤트가 없으면 null (DB가 lastModifyingUser로 대체)", () => {
  assert.equal(attribute(period, [], { added: 10, removed: 0 }), null);
});

test("구간 시작이 없으면(문서 처음) 끝 이전 편집 전부", () => {
  const times = editTimeByPerson([{ personId: "A", start: t("10:00:00"), end: t("10:10:00") }], {
    start: null,
    end: t("14:00:00"),
  });
  assert.equal(times.get("A"), 600_000);
});

test("allocate 합계 보존", () => {
  assert.deepEqual(allocate(10, [1 / 3, 1 / 3, 1 / 3]), [4, 3, 3]);
  assert.deepEqual(allocate(0, [0.5, 0.5]), [0, 0]);
});

test("사람별 편집 시간대 (구간으로 잘린 처음 ~ 마지막 편집)", () => {
  const credits = attribute(
    period,
    [
      { personId: "A", start: t("13:59:00"), end: t("14:00:40") },
      { personId: "A", start: t("14:01:00"), end: t("14:01:20") },
      { personId: "B", start: t("14:01:50"), end: t("14:01:50") },
    ],
    { added: 10, removed: 0 },
  );
  const a = credits.find((c) => c.person_id === "A");
  const b = credits.find((c) => c.person_id === "B");
  assert.deepEqual([a.edited_from, a.edited_to], ["2026-11-07T14:00:00.000Z", "2026-11-07T14:01:20.000Z"]);
  assert.deepEqual([b.edited_from, b.edited_to], ["2026-11-07T14:01:20.000Z", "2026-11-07T14:01:50.000Z"]);
});
