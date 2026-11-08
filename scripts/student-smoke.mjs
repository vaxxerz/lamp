import assert from "node:assert/strict";

const baseUrl = process.env.LAMP_TEST_URL || "http://localhost:3000";
const request = (path, options) =>
  fetch(new URL(path, baseUrl), { ...options, redirect: "manual" });

assert.equal((await request("/login")).status, 200);

for (const path of [
  "/lamp",
  "/lamp/documents?source=invite",
  "/lamp/activities?doc=qa",
  "/lamp/documents/fixture.svg",
]) {
  const response = await request(path);
  assert.equal(response.status, 307, path);
  const login = new URL(response.headers.get("location"), baseUrl);
  assert.equal(login.origin, new URL(baseUrl).origin);
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), path);
}

async function signInDemo(role, destination) {
  const signIn = await request("/api/demo-login", {
    method: "POST",
    body: new URLSearchParams({ role, next: destination }),
  });
  assert.equal(signIn.status, 303);
  assert.equal(signIn.headers.get("location"), new URL(destination, baseUrl).href);
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie, `Demo sign-in should issue a ${role} session cookie`);
  return { cookie };
}

const destination = "/lamp/documents?source=invite";
const studentHeaders = await signInDemo("student", destination);
const workspace = await request(destination, { headers: studentHeaders });
assert.equal(workspace.status, 200);

const professorHeaders = await signInDemo("professor", "/professor");
for (const [headers, home] of [[studentHeaders, "/lamp"], [professorHeaders, "/professor"]]) {
  const login = await request("/login?next=%2Flamp%2Fdocuments", { headers });
  assert.equal(login.status, 307);
  assert.equal(new URL(login.headers.get("location"), baseUrl).href, new URL(home, baseUrl).href);
}
console.log("PASS: signed-out users reach login, and signed-in students and professors reach their own home.");
