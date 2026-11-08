import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs";
const base = process.env.LAMP_TEST_URL || "http://localhost:3000";
const out =
  process.env.LAMP_TEST_ARTIFACTS || "/tmp/lamp-professor-team-artifacts";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/professor-demo/dashboard`);
  await page.getByRole("heading", { name: "팀별 지표" }).waitFor();
  const before = await page.evaluate(() => ({
    professor: localStorage.getItem("lamp-professor-teams-v1"),
    student: localStorage.getItem("lamp-student-demo-v1"),
  }));
  await page
    .locator(".prof-team-row:visible")
    .getByRole("link", { name: "등잔 팀", exact: true })
    .click();
  await page.waitForURL(/teams\/t1\/dashboard/);
  await page.getByRole("heading", { level: 1, name: "등잔 팀" }).waitFor();
  await page
    .getByRole("heading", { level: 1, name: "등잔 팀", exact: true })
    .waitFor();
  assert.equal(await page.locator(".lamp-recent-row").count(), 4);
  await page.getByRole("button", { name: "팀 정보 보기" }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator(".lamp-team-members strong").count(), 3);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${out}/team-dashboard.png`, fullPage: true });
  await page.getByRole("link", { name: "연결된 문서", exact: true }).click();
  await page.getByRole("heading", { name: "연결된 Google 문서" }).waitFor();
  assert.deepEqual(await page.locator(".lamp-document h3").allTextContents(), [
    "서비스 기획서",
    "중간 발표",
  ]);
  assert.equal(
    await page.getByRole("button", { name: /연결하기|새 문서 연결/ }).count(),
    0,
  );
  await page.getByRole("link", { name: "기여 기록", exact: true }).click();
  await page.getByRole("heading", { name: "총 14개의 활동" }).waitFor();
  assert.equal(await page.locator(".lamp-activity").count(), 10);
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  assert.equal(await page.locator(".lamp-activity").count(), 14);
  await page.getByLabel("학생", { exact: true }).selectOption("u1");
  assert.equal(await page.locator(".lamp-activity").count(), 4);
  await page.getByLabel("학생", { exact: true }).selectOption("all");
  await page.getByRole("link", { name: "AI 보고서", exact: true }).click();
  await page
    .getByRole("heading", { name: "등잔 팀 팀 전체 기여 요약" })
    .waitFor();
  assert.equal(await page.locator(".lamp-evidence li").count(), 9);
  await page.getByLabel("보고서 학생").selectOption("u1");
  await page.getByRole("heading", { name: "김지민님의 기여 요약" }).waitFor();
  assert.equal(await page.locator(".lamp-evidence li").count(), 3);
  await page.locator('.lamp-evidence a[href*="record=pa13"]').click();
  await page.locator("#pa13").waitFor();
  assert.equal(await page.locator(".lamp-activity").count(), 14);
  await page.getByRole("link", { name: "회의록 · 출석", exact: true }).click();
  await page.getByRole("heading", { name: "중간 발표 준비" }).waitFor();
  assert.equal(await page.locator(".prof-team-attendance").count(), 3);
  assert.equal(
    await page.locator(".prof-team-attendance select, textarea").count(),
    0,
  );
  await page
    .locator("#lamp-sidebar")
    .getByRole("link", { name: "대시보드", exact: true })
    .first()
    .click();
  await page.waitForURL(/professor-demo\/dashboard(\?course=\w+)?$/);
  await page.getByRole("heading", { name: "팀별 지표" }).waitFor();
  await page
    .locator(".prof-team-row:visible")
    .getByRole("link", { name: "보라 팀", exact: true })
    .click();
  await page
    .getByRole("heading", { level: 1, name: "보라 팀", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "기여 기록", exact: true }).click();
  await page.getByRole("heading", { name: "총 2개의 활동" }).waitFor();
  assert.equal(await page.locator("#pa1").count(), 0);
  await page.reload();
  await page.getByRole("heading", { name: "총 2개의 활동" }).waitFor();
  await page.goto(`${base}/professor-demo/teams/t3/dashboard`);
  await page
    .getByRole("heading", { level: 1, name: "데이터 랩", exact: true })
    .waitFor();
  assert.equal(await page.locator(".lamp-recent-row").count(), 0);
  await page.goto(`${base}/professor-demo/teams/not-owned/dashboard`);
  await page.getByRole("heading", { name: "접근 권한이 없습니다" }).waitFor();
  assert.equal(await page.locator(".lamp-heading").count(), 0);
  const after = await page.evaluate(() => ({
    professor: localStorage.getItem("lamp-professor-teams-v1"),
    student: localStorage.getItem("lamp-student-demo-v1"),
  }));
  assert.deepEqual(after, before);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of [
    "dashboard",
    "documents",
    "activities",
    "reports",
    "meetings",
  ]) {
    await page.goto(`${base}/professor-demo/teams/t1/${view}`);
    await page.locator(".lamp-heading").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow: ${view}`,
    );
  }
  await page.screenshot({ path: `${out}/team-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "메뉴 열기 또는 닫기" }).click();
  await page
    .locator("#lamp-sidebar")
    .getByRole("link", { name: "대시보드", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "팀별 지표" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: professor card → selected student-style team workspace → Lamp returns to professor dashboard; all 5 team menus, details, reports/evidence beyond pagination, read-only attendance, team isolation/reload/empty/denied states, unchanged storage, mobile layouts and logo return; no browser errors.",
  );
} finally {
  await browser.close();
}
