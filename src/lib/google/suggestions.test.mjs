// 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSuggestions, matchAuthors, parseTrackedChanges, suggestionHash } from "./suggestions.ts";

const run = (startIndex, content, ins, del) => ({
  startIndex,
  textRun: { content, ...(ins ? { suggestedInsertionIds: [ins] } : {}), ...(del ? { suggestedDeletionIds: [del] } : {}) },
});

test("Docs API 응답에서 제안 추출 (같은 ID의 추가 · 삭제 합치기, 표 안 포함, 문서 순서)", () => {
  const doc = {
    body: {
      content: [
        {},
        { paragraph: { elements: [run(1, "예산은 "), run(5, "100", null, "s.b"), run(8, "250", "s.b"), run(11, "만원\n")] } },
        {
          table: {
            tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [run(20, "표 안 제안", "s.c")] } }] }] }],
          },
        },
        { paragraph: { elements: [run(2, " 경쟁사 분석", "s.a"), run(9, "\n")] } },
      ],
    },
  };
  assert.deepEqual(
    extractSuggestions(doc).map((s) => [s.id, s.added, s.removed]),
    [
      ["s.a", " 경쟁사 분석", ""],
      ["s.b", "250", "100"],
      ["s.c", "표 안 제안", ""],
    ],
  );
});

test("docx 변경 추적 파싱 (작성자 · 시각 · XML 이스케이프 · 삭제 텍스트)", () => {
  const xml =
    '<w:p><w:ins w:id="0" w:author="민성 &amp; 팀" w:date="2026-11-07T07:32:24Z"><w:r><w:t xml:space="preserve"> A&lt;B</w:t></w:r></w:ins>' +
    '<w:del w:id="1" w:author="왕유" w:date="2026-11-07T07:33:00Z"><w:r><w:delText>결론 </w:delText></w:r></w:del></w:p>';
  assert.deepEqual(parseTrackedChanges(xml), [
    { kind: "ins", author: "민성 & 팀", date: "2026-11-07T07:32:24Z", text: " A<B" },
    { kind: "del", author: "왕유", date: "2026-11-07T07:33:00Z", text: "결론 " },
  ]);
});

test("제안마다 작성자 짝짓기 — 교체는 추가 쪽 작성자, 여러 run으로 쪼개진 조각도 연결", () => {
  const suggestions = [
    { id: "s.a", added: " 경쟁사 분석", removed: "", startIndex: 2 },
    { id: "s.b", added: "250", removed: "100", startIndex: 5 },
  ];
  const changes = [
    { kind: "ins", author: "민성", date: "t1", text: " 경쟁사" },
    { kind: "ins", author: "민성", date: "t1", text: " 분석" },
    { kind: "del", author: "왕유", date: "t2", text: "100" },
    { kind: "ins", author: "왕유", date: "t2", text: "250" },
  ];
  assert.deepEqual(
    matchAuthors(suggestions, changes).map((m) => [m.id, m.author, m.date]),
    [
      ["s.a", "민성", "t1"],
      ["s.b", "왕유", "t2"],
    ],
  );
});

test("같은 내용 제안이 여러 개면 문서 순서대로 짝짓기", () => {
  const suggestions = [
    { id: "s.1", added: "네", removed: "", startIndex: 1 },
    { id: "s.2", added: "네", removed: "", startIndex: 9 },
  ];
  const changes = [
    { kind: "ins", author: "민성", date: null, text: "네" },
    { kind: "ins", author: "신환", date: null, text: "네" },
  ];
  assert.deepEqual(
    matchAuthors(suggestions, changes).map((m) => m.author),
    ["민성", "신환"],
  );
});

test("docx에 아직 없는 제안은 빼고(다음 차례), 공백뿐인 제안은 작성자 없이 통과", () => {
  const suggestions = [
    { id: "s.new", added: "방금 쓴 문장", removed: "", startIndex: 1 },
    { id: "s.nl", added: "\n", removed: "", startIndex: 20 },
  ];
  assert.deepEqual(
    matchAuthors(suggestions, []).map((m) => [m.id, m.author]),
    [["s.nl", ""]],
  );
});

test("입력 중 판단용 해시 — 내용이 바뀌면 달라짐", () => {
  const a = { id: "x", added: "안녕", removed: "", startIndex: 1 };
  assert.equal(suggestionHash(a), suggestionHash({ ...a }));
  assert.notEqual(suggestionHash(a), suggestionHash({ ...a, added: "안녕하" }));
});
