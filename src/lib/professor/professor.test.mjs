import assert from "node:assert/strict";
import { test } from "node:test";
import { professorMock } from "./mock-data.ts";
import { scopeProfessorData, ProfessorAccessError } from "./scope.ts";
test("교수 담당 courseId 범위 밖의 팀·문서·활동·회의 제외", () => {
  const data = structuredClone(professorMock);
  data.courses[0].professorId = "another-professor";
  const result = scopeProfessorData(data);
  assert.deepEqual(
    result.teams.map((t) => t.id),
    ["t3"],
  );
  assert.equal(result.activities.length, 0);
  assert.equal(result.documents.length, 0);
  assert.equal(result.meetings.length, 0);
  assert.deepEqual(
    result.users.map((u) => u.id),
    ["u6"],
  );
});
test("교수 역할이 아니면 범위를 반환하지 않음", () => {
  const data = structuredClone(professorMock);
  data.professor.role = "student";
  assert.throws(() => scopeProfessorData(data), ProfessorAccessError);
});
test("다른 팀 문서에 연결된 활동 제외", () => {
  const data = structuredClone(professorMock);
  data.activities[0].documentId = "d3";
  assert.equal(
    scopeProfessorData(data).activities.some((a) => a.id === "pa1"),
    false,
  );
});
test("활동 구성 이벤트도 담당 수업 범위만 반환한다", () => {
  // Given a professor whose first course belongs to someone else.
  const data = structuredClone(professorMock);
  data.courses[0].professorId = 'another-professor';
  data.events = [{ teamId: 't1', userId: 'u1', category: 'task', createdAt: '2026-11-07T00:00:00Z' },
    { teamId: 't3', userId: 'u6', category: 'file', createdAt: '2026-11-07T00:00:00Z' }];
  // When scoping the data to the current professor.
  const result = scopeProfessorData(data);
  // Then activity composition cannot expose another professor's team.
  assert.deepEqual(result.events.map(event => event.teamId), ['t3']);
});
