// 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { homeAfterSignup, parseSignupIntent } from "./signup.ts";

const enc = (v) => encodeURIComponent(JSON.stringify(v));

test("가입 의사 쿠키: 정상 값", () => {
  assert.deepEqual(parseSignupIntent(enc({ role: "student", studentNo: "2026012345", department: " 컴소 " })), {
    role: "student",
    studentNo: "2026012345",
    department: "컴소",
  });
  assert.equal(parseSignupIntent(enc({ role: "professor" }))?.role, "professor");
});

test("가입 의사 쿠키: 이상한 값은 거르거나 버린다", () => {
  assert.equal(parseSignupIntent(undefined), null);
  assert.equal(parseSignupIntent("not-json"), null);
  assert.equal(parseSignupIntent(enc({ role: "admin" })), null);
  assert.equal(parseSignupIntent(enc({ role: "student", studentNo: "12ab" }))?.studentNo, "");
  assert.equal(parseSignupIntent(enc({ role: "student", department: "x".repeat(200) }))?.department.length, 60);
});

test("가입 결과별 첫 화면", () => {
  assert.equal(homeAfterSignup("professor"), "/professor");
  assert.equal(homeAfterSignup("pending"), "/signup/pending");
  assert.equal(homeAfterSignup("student"), "/lamp");
});
