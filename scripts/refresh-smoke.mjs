import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const baseURL = process.env.LAMP_TEST_URL ?? "http://localhost:3100";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  headless: true,
});
const errors = [];
const context = await browser.newContext({ baseURL });
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));

async function login(session, role) {
  const response = await session.request.post("/api/demo-login", {
    form: { role }, maxRedirects: 0,
  });
  assert.equal(response.status(), 303);
}

try {
  // Given the current build and an untouched page.
  const versionResponse = await context.request.get("/api/version");
  assert.match(versionResponse.headers()["cache-control"], /no-store/);
  const { version } = await versionResponse.json();
  let nextVersion = version;
  await context.route("**/api/version?*", async (route) => {
    const responseVersion = nextVersion;
    nextVersion = version;
    await route.fulfill({ json: { version: responseVersion } });
  });
  const page = await context.newPage();
  let navigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
  });
  await page.clock.install();
  const initialVersion = page.waitForResponse((response) => response.url().includes("/api/version?"));
  await page.goto("/login");
  await page.getByRole("button", { name: "학생으로 체험", exact: true }).waitFor();
  await initialVersion;
  const checkVersion = async () => {
    await page.waitForLoadState("networkidle");
    const response = page.waitForResponse((response) => response.url().includes("/api/version?"));
    await page.clock.runFor(30_000);
    await response;
    await page.waitForLoadState("networkidle");
  };
  const initialNavigations = navigations;
  // When the server reports the same deployment.
  await checkVersion();
  // Then there is no reload loop.
  assert.equal(navigations, initialNavigations);

  // Given an idle page, when a new deployment appears.
  nextVersion = "smoke-new-deployment";
  const reload = page.waitForEvent("load");
  await checkVersion();
  await reload;
  // Then it reloads in place.
  assert.equal(navigations, initialNavigations + 1);
  assert.equal(new URL(page.url()).pathname, "/login");
  console.log("PASS: unchanged deployments stay open; a new deployment reloads automatically.");

  // Given a real meeting creation form with an unsaved title.
  await login(context, "student");
  await page.goto("/lamp/meetings");
  await page.getByRole("button", { name: "새 회의 만들기", exact: true }).click();
  const title = page.getByLabel("회의 제목", { exact: true });
  await title.fill("아직 저장하지 않은 회의 제목");
  await page.getByRole("heading", { name: "새 회의", exact: true }).click();
  const beforeEditCheck = navigations;
  // When a deployment changes while typing has finished but the field is unsaved.
  nextVersion = "smoke-new-deployment-with-draft";
  await checkVersion();
  // Then the page and the draft survive.
  assert.equal(navigations, beforeEditCheck);
  assert.equal(await title.inputValue(), "아직 저장하지 않은 회의 제목");
  // Given that draft, when the user cancels the form.
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  const safeReload = page.waitForEvent("load");
  await page.clock.runFor(30_000);
  await safeReload;
  // Then the deferred deployment is applied.
  assert.equal(navigations, beforeEditCheck + 1);
  console.log("PASS: an unsaved meeting blocks reload until its form is closed.");

  // Given student and professor pages looking at the same real demo class.
  const professor = await browser.newContext({ baseURL });
  await login(professor, "professor");
  const professorPage = await professor.newPage();
  professorPage.on("pageerror", (error) => errors.push(error.message));
  await professorPage.goto("/professor/meetings");
  await professorPage.getByRole("heading", { name: "회의록·출석", exact: true }).waitFor();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: student } = await admin.from("profiles").select("id").eq("email", "student1@demo.lamp").single();
  assert.ok(student);
  const { data: memberships } = await admin.from("team_members").select("team_id").eq("user_id", student.id);
  assert.ok(memberships?.length);
  const teamId = memberships[0].team_id;
  const marker = `자동 갱신 검사 ${crypto.randomUUID()}`;
  let meetingId;
  try {
    // When a meeting is inserted outside either open page.
    const { data: meeting, error } = await admin.from("meetings").insert({
      team_id: teamId, title: marker, held_at: new Date().toISOString(),
      location: "자동 검사", created_by: student.id,
    }).select("id").single();
    if (error) throw error;
    meetingId = meeting.id;
    // Then both pages show it through Realtime, without navigation or manual reload.
    await page.getByText(marker, { exact: true }).first().waitFor({ timeout: 15_000 });
    await professorPage.getByText(marker, { exact: true }).first().waitFor({ timeout: 15_000 });
    console.log("PASS: student and professor pages receive an inserted meeting through Realtime.");
  } finally {
    if (meetingId) {
      const { error } = await admin.from("meetings").delete().eq("id", meetingId);
      if (error) throw error;
      await page.getByText(marker, { exact: true }).first().waitFor({ state: "hidden", timeout: 15_000 });
      await professorPage.getByText(marker, { exact: true }).first().waitFor({ state: "hidden", timeout: 15_000 });
      console.log("PASS: both pages also remove deleted meetings automatically.");
    }
    await professor.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
