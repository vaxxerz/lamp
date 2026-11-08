import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs";
const base = process.env.LAMP_TEST_URL || "http://localhost:3000";
const out = process.env.LAMP_TEST_ARTIFACTS || "/tmp/lamp-professor-artifacts";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  // 모든 수업 홈 → 수업 하나 고르기 → 그 수업 대시보드
  await page.goto(`${base}/professor-demo`);
  await page
    .getByRole("heading", { level: 1, name: "김교수님의 수업" })
    .waitFor();
  assert.equal(await page.locator(".prof-course-tile").count(), 2);
  await page
    .locator(".prof-course-tile", { hasText: "데이터 사이언스" })
    .click();
  await page
    .getByRole("heading", { level: 1, name: "데이터 사이언스" })
    .waitFor();
  // 수업 화면은 팀별 지표만 — 팀 한 줄 = 팀 하나
  assert.equal(await page.locator(".prof-team-row:visible").count(), 1);
  await page.goto(`${base}/professor-demo/dashboard`);
  await page.getByRole("heading", { name: "팀별 지표" }).waitFor();
  assert.equal(await page.locator(".prof-team-row:visible").count(), 3);
  assert.deepEqual(
    (await page.locator(".lamp-metrics dd").allTextContents()).slice(0, 3),
    ["3", "6", "3"],
  );
  // 수업 화면에는 팀원별 분석이 없다
  assert.equal(
    await page.locator(".prof-member-table, .prof-share").count(),
    0,
  );
  await page.screenshot({ path: `${out}/dashboard.png`, fullPage: true });
  // 사이드바 팀 탭으로 팀 화면 → 팀원 분석은 팀 안에서
  await page
    .locator("#lamp-sidebar")
    .getByRole("link", { name: /데이터 랩/ })
    .click();
  await page
    .getByRole("heading", { level: 1, name: "데이터 랩", exact: true })
    .waitFor();
  await page
    .locator("#lamp-sidebar")
    .getByRole("link", { name: "팀원 분석", exact: true })
    .click();
  await page.getByRole("heading", { level: 1, name: "팀원 분석" }).waitFor();
  assert.equal(await page.locator(".prof-member-table:visible").count(), 1);
  await page
    .locator("#lamp-sidebar")
    .getByRole("link", { name: "대시보드", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "팀별 지표" }).waitFor();
  await page.getByRole("link", { name: "과목·팀 관리", exact: true }).click();
  await page.getByLabel("소속 과목").selectOption("c2");
  await page.getByLabel("팀 이름").fill("교수 테스트 팀");
  await page.getByRole("button", { name: "팀 생성", exact: true }).click();
  const card = page.locator(".prof-team").filter({
    has: page.getByRole("heading", { name: "교수 테스트 팀", exact: true }),
  });
  await card.waitFor();
  const initialCode = await card.locator("code").textContent();
  await card.getByRole("button", { name: "코드 재발급", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(await card.locator("code").textContent(), initialCode);
  await card.getByRole("button", { name: "코드 재발급", exact: true }).click();
  await page.getByRole("button", { name: "재발급 확인", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const changedCode = await card.locator("code").textContent();
  assert.notEqual(changedCode, initialCode);
  await page.reload();
  await card.waitFor();
  assert.equal(await card.locator("code").textContent(), changedCode);
  // 예전 수업 단위 주소는 팀 화면으로 옮겨진다
  await page.goto(`${base}/professor-demo/activities?team=t1&record=pa3`);
  await page.waitForURL(/teams\/t1\/activities\?record=pa3$/);
  await page.locator("#pa3").waitFor();
  await page.goto(`${base}/professor-demo/reports?course=c1`);
  await page.waitForURL(/dashboard\?course=c1$/);
  await page.goto(`${base}/professor-demo/dashboard?course=not-owned`);
  await page.getByRole("heading", { name: "접근 권한이 없습니다" }).waitFor();
  assert.equal(await page.locator(".prof-team-row:visible").count(), 0);
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  for (const view of ["home", "dashboard", "courses"]) {
    await mobile.goto(
      `${base}/professor-demo${view === "home" ? "" : `/${view}`}`,
    );
    await mobile.locator(".lamp-heading").waitFor();
    assert.equal(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `mobile overflow: ${view}`,
    );
    await mobile.screenshot({
      path: `${out}/mobile-${view}.png`,
      fullPage: true,
    });
  }
  await mobile.getByRole("button", { name: "메뉴 열기 또는 닫기" }).click();
  await mobile.getByRole("link", { name: "과목·팀 관리", exact: true }).click();
  await mobile
    .getByRole("heading", { name: "교수 생성 팀", exact: true })
    .waitFor();
  assert.equal(
    await mobile
      .getByRole("button", { name: "메뉴 열기 또는 닫기" })
      .getAttribute("aria-expanded"),
    "false",
  );
  await page.goto(`${base}/professor-demo`);
  await page.locator(".lamp-heading").waitFor();
  await page.evaluate(() =>
    localStorage.setItem("lamp-professor-teams-v1", "broken-json"),
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "데이터를 불러오지 못했어요" })
    .waitFor();
  await page.getByRole("button", { name: "데모 팀 초기화" }).click();
  await page.getByRole("heading", { name: "모든 수업의 팀" }).waitFor();
  assert.equal(await page.locator(".lamp-table tbody tr").count(), 3);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: course dashboard shows team metrics only, sidebar team tabs → team member analysis, team creation/persistence, code rotation/cancel, legacy course URLs move to team pages, denied access, mobile layouts/menu, corrupted storage recovery; no browser errors.",
  );
} finally {
  await browser.close();
}
