// 발표 시연용 데모 데이터 시드 (여러 번 실행해도 안전 — 데모 팀은 지우고 다시 만든다)
//   실행: npm run seed:demo   (= node --env-file=.env.local scripts/seed-demo.mjs)
//   필요: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD
//
//  만드는 것 (교수 professor@demo.lamp ↔ 학생 student1@demo.lamp 가 같은 과목 · 팀으로 연결됨)
//   - 교수 김태호: 소프트웨어공학(4팀) · 데이터베이스설계(2팀) 담당
//   - 학생 이서연(student1): 소프트웨어공학 1팀(팀장) + 데이터베이스설계 1조 + 독립 팀플 "알고리즘 스터디"
//   - 팀마다 8주치 기록: 구글 문서 수정 이력 · 제안 · 형광펜, 칸반 태스크, 주간 회의 · 회의록 · 출결 · 댓글,
//     파일 버전, 👍, 상호평가, 알림. 날짜는 실행 시점 기준으로 만든다 (시연 직전에 한 번 더 돌리면 "방금 전" 활동 유지)
//   - 시나리오: 1팀 정민재 = 무임승차 (상호평가는 후하지만 활동은 거의 없음), 3팀 강민서 = 혼자 캐리, 4팀 = 막판 몰아치기
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  COMMENTS,
  COURSES,
  DB_TOPICS,
  LOCATIONS,
  PROFESSOR,
  SE_TOPICS,
  STUDENTS,
  STUDY_TOPICS,
  TASK_TEMPLATES,
  TEAMS,
} from "./demo-content.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !key || !anonKey || !password) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD 를 .env.local 에 설정하세요",
  );
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
async function insertAll(table, rows, what = table) {
  for (let i = 0; i < rows.length; i += 400) {
    must(await admin.from(table).insert(rows.slice(i, i + 400)), `insert ${what}`);
  }
}
async function upsertAll(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 400) {
    must(await admin.from(table).upsert(rows.slice(i, i + 400), { onConflict }), `upsert ${table}`);
  }
}

// ---------- 결정적 난수 (같은 날 다시 돌려도 비슷한 모양) ----------
let seed = 20261108;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
function weighted(items, weightOf) {
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  let r = rand() * total;
  for (const x of items) {
    r -= weightOf(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}

// ---------- 시간 ----------
const NOW = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const KST = 9 * HOUR;
/** KST 자정 기준 프로젝트 시작일 (지금이 9주차 안에 오도록 59일 전) */
const kstMidnight = (ms) => Math.floor((ms + KST) / DAY) * DAY - KST;
const START = kstMidnight(NOW - 59 * DAY);
const weekOf = (ms) => Math.max(0, Math.min(8, Math.floor((ms - START) / (7 * DAY))));
const iso = (ms) => new Date(ms).toISOString();
const SAFE_NOW = NOW - 20 * 60_000;
/** w주차 안의 활동 시각 (KST 10~24시, 미래 금지) */
function timeInWeek(w) {
  for (let i = 0; i < 20; i++) {
    const t = START + (w * 7 + Math.floor(rand() * 7)) * DAY + (10 + rand() * 14) * HOUR;
    if (t < SAFE_NOW && t >= START) return t;
  }
  return SAFE_NOW - rand() * 2 * DAY;
}
/** [w0, w1] 주차 구간에서 팀 활동량 모양에 맞춰 시각 하나 */
function timeInWindow(w0, w1, team) {
  const nowWeek = weekOf(SAFE_NOW);
  const weeks = [];
  for (let w = w0; w <= Math.min(w1, nowWeek); w++) weeks.push(w);
  if (!weeks.length) weeks.push(nowWeek);
  return timeInWeek(weighted(weeks, (w) => team.shape[w] ?? 1));
}
const fmtDate = (ms) => {
  const d = new Date(ms + KST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const ymd = (ms) => new Date(ms + KST).toISOString().slice(0, 10);

// ============================================================
// 1) 계정
// ============================================================
const ACCOUNTS = [PROFESSOR, ...STUDENTS];
must(
  await admin.from("demo_accounts").upsert(
    ACCOUNTS.map(({ email, role }) => ({ email, role, note: "심사용 데모 계정" })),
    { onConflict: "email" },
  ),
  "demo_accounts",
);
const { users: authUsers } = must(await admin.auth.admin.listUsers({ perPage: 1000 }), "listUsers");
const ids = {};
for (const a of ACCOUNTS) {
  const existing = authUsers.find((u) => u.email === a.email);
  if (existing) {
    // 비밀번호가 이미 맞으면 건드리지 않는다 (바꾸면 열려 있던 시연 세션이 로그아웃됨)
    const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const ok = !(await probe.auth.signInWithPassword({ email: a.email, password })).error;
    must(
      await admin.auth.admin.updateUserById(existing.id, { ...(ok ? {} : { password }), user_metadata: { full_name: a.name } }),
      `update ${a.email}`,
    );
    ids[a.key ?? "professor"] = existing.id;
    continue;
  }
  const { user } = must(
    await admin.auth.admin.createUser({
      email: a.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: a.name },
      app_metadata: { demo: true },
    }),
    `create ${a.email}`,
  );
  ids[a.key ?? "professor"] = user.id;
  console.log("✓ created", a.email);
}
const PROF_ID = ids.professor;
for (const a of ACCOUNTS) {
  must(
    await admin
      .from("profiles")
      .update({
        name: a.name,
        role: a.role,
        email: a.email,
        student_no: a.studentNo ?? null,
        department: a.role === "student" ? "컴퓨터소프트웨어학부" : "컴퓨터소프트웨어학부 교수",
      })
      .eq("id", ids[a.key ?? "professor"]),
    `profile ${a.email}`,
  );
}
const nameOf = Object.fromEntries(ACCOUNTS.map((a) => [ids[a.key ?? "professor"], a.name]));
const emailOf = Object.fromEntries(ACCOUNTS.map((a) => [ids[a.key ?? "professor"], a.email]));
const DEMO_IDS = new Set(Object.values(ids));
// 알림 테이블(마이그레이션 018)이 아직 없는 DB면 알림 단계는 건너뛴다
const HAS_NOTIFICATIONS = !(await admin.from("notifications").select("id").limit(1)).error;
if (!HAS_NOTIFICATIONS) console.log("  (notifications 테이블 없음 — 알림 시드는 건너뜀)");
console.log(`✓ 계정 ${ACCOUNTS.length}개`);

// 출결 체크는 "다른 팀원이 체크"한 기록이 남도록 그 학생으로 로그인해서 한다
const sessions = {};
async function as(uid) {
  if (sessions[uid]) return sessions[uid];
  const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await c.auth.signInWithPassword({ email: emailOf[uid], password }), `login ${emailOf[uid]}`);
  sessions[uid] = c;
  return c;
}

// ============================================================
// 2) 과목 · 기존 데모 팀 정리
// ============================================================
const courseIds = {};
for (const c of COURSES) {
  if (c.kind === "independent") continue;
  const names = [c.name, ...c.legacyNames];
  let course = must(
    await admin.from("courses").select("id, invite_code").eq("professor_id", PROF_ID).in("name", names).limit(1).maybeSingle(),
    "course",
  );
  if (!course) {
    course = must(
      await admin
        .from("courses")
        .insert({ professor_id: PROF_ID, kind: "class", name: c.name, semester: c.semester, ...c.weights })
        .select("id, invite_code")
        .single(),
      "insert course",
    );
  } else {
    must(await admin.from("courses").update({ name: c.name, semester: c.semester, ...c.weights }).eq("id", course.id), "update course");
  }
  courseIds[c.key] = course.id;
  c.inviteCode = course.invite_code;
}

/** 데모 계정만 들어 있는 팀(또는 빈 팀)만 지운다 — 실제 사용자가 만든 팀은 건드리지 않음 */
async function wipeTeams(teamRows) {
  for (const t of teamRows) {
    const members = must(await admin.from("team_members").select("user_id").eq("team_id", t.id), "members");
    if (members.some((m) => !DEMO_IDS.has(m.user_id))) {
      console.log(`  (건너뜀: 데모 외 사용자가 있는 팀 ${t.name})`);
      continue;
    }
    const files = must(await admin.from("file_versions").select("storage_path").eq("team_id", t.id), "file paths");
    if (files.length) await admin.storage.from("team-files").remove(files.map((f) => f.storage_path));
    must(await admin.from("teams").delete().eq("id", t.id), `delete team ${t.name}`);
  }
}
await wipeTeams(must(await admin.from("teams").select("id, name").in("course_id", Object.values(courseIds)), "old teams"));
// 독립 팀플: 데모 학생들이 만든 독립 과목 통째로
const indCourses = must(
  await admin.from("courses").select("id, name").eq("kind", "independent").in("name", COURSES.filter((c) => c.kind === "independent").map((c) => c.name)),
  "independent courses",
);
for (const c of indCourses) {
  const members = must(await admin.from("course_members").select("user_id").eq("course_id", c.id), "ind members");
  if (members.length && members.every((m) => DEMO_IDS.has(m.user_id))) {
    await wipeTeams(must(await admin.from("teams").select("id, name").eq("course_id", c.id), "ind teams"));
    must(await admin.from("courses").delete().eq("id", c.id), "delete ind course");
  }
}
for (const c of COURSES.filter((c) => c.kind === "independent")) {
  const course = must(
    await admin.from("courses").insert({ kind: "independent", professor_id: null, name: c.name, semester: c.semester }).select("id").single(),
    "insert independent course",
  );
  courseIds[c.key] = course.id;
}
console.log("✓ 과목 · 기존 데모 팀 정리");

// ============================================================
// 3) 팀별 생성
// ============================================================
const POLISH = [
  " (인터뷰 결과 반영)",
  " — 교수님 피드백 반영",
  " 단, 예외 상황은 별도 안내 화면으로 처리한다.",
  " (1차 검토 완료)",
  " 세부 수치는 테스트 후 확정한다.",
  " (우선순위 상향)",
];
const ROLES = ["PM · 기획", "백엔드", "프론트엔드", "디자인 · QA"];
const DB_ROLES = ["모델링 · 문서", "DDL · 제약 조건", "쿼리 · 튜닝", "테스트 데이터"];
const summary = [];

for (const team of TEAMS) {
  const courseId = courseIds[team.course];
  const members = team.members.map((m) => ({ ...m, id: ids[m.s], name: nameOf[ids[m.s]] }));
  const active = members.filter((m) => !m.rider);
  const byLevel = (m) => m.level;
  const leader = members[0];
  const isClass = team.course !== "IND";
  const isDB = team.course === "DB";

  // ----- 팀 · 멤버 -----
  const teamId = randomUUID();
  must(
    await admin.from("teams").insert({
      id: teamId,
      course_id: courseId,
      name: team.name,
      invite_code: isClass ? null : randomUUID().slice(0, 6).toUpperCase(),
      created_at: iso(NOW - team.joinedDaysAgo * DAY - HOUR),
    }),
    `team ${team.name}`,
  );
  await upsertAll(
    "course_members",
    members.map((m, i) => ({ course_id: courseId, user_id: m.id, joined_at: iso(NOW - team.joinedDaysAgo * DAY - 2 * HOUR + i * 600_000) })),
    "course_id,user_id",
  );
  // 이서연의 기본 팀이 소프트웨어공학 1팀이 되도록 joined_at을 팀 순서대로
  await insertAll(
    "team_members",
    members.map((m, i) => ({
      team_id: teamId,
      course_id: courseId,
      user_id: m.id,
      joined_at: iso(NOW - team.joinedDaysAgo * DAY + i * 900_000),
    })),
  );

  const events = []; // 직접 넣는 활동 이벤트
  const notable = []; // 알림용 주요 활동
  const featureNames = team.features.map((f) => f[0]);

  // ----- 구글 문서 -----
  const docSpecs = buildDocSpecs(team, members, isDB);
  const extDocs = [];
  const revisions = [];
  const credits = [];
  const suggestions = [];
  for (const spec of docSpecs) {
    const docId = randomUUID();
    const lines = [];
    const steps = [];
    // 줄을 1~3개씩 묶어 revision 하나로, 가끔 기존 줄을 다듬는 수정 revision
    const times = [];
    let i = 0;
    const chunks = [];
    while (i < spec.lines.length) {
      const n = Math.min(spec.lines.length - i, 1 + Math.floor(rand() * 3));
      chunks.push(spec.lines.slice(i, i + n));
      i += n;
    }
    const editCount = Math.round(chunks.length * 0.25);
    for (let k = 0; k < chunks.length + editCount; k++) times.push(timeInWindow(spec.window[0], spec.window[1], team));
    times.sort((a, b) => a - b);
    for (let k = 1; k < times.length; k++) if (times[k] - times[k - 1] < 5 * 60_000) times[k] = times[k - 1] + 5 * 60_000;
    const createdAt = times[0] - (1 + rand() * 2) * HOUR;
    // 처음엔 줄 추가, 이후 섞어서 수정
    let ci = 0;
    let ei = 0;
    for (let k = 0; k < times.length; k++) {
      const remainingChunks = chunks.length - ci;
      const doEdit = ei < editCount && lines.length > 4 && (remainingChunks === 0 || chance(editCount / times.length));
      if (doEdit) {
        ei++;
        const li = 2 + Math.floor(rand() * (lines.length - 2));
        const before = lines[li];
        const after = polish(before);
        if (after === before) continue;
        lines[li] = after;
        steps.push({ at: times[k], op: "edit", line: li, removed: before, added: after });
      } else if (ci < chunks.length) {
        const chunk = chunks[ci++];
        const at = lines.length;
        lines.push(...chunk);
        steps.push({ at: times[k], op: "insert", line: at, added: chunk.join("\n"), lines: chunk });
      }
    }
    let prevAt = null;
    let lastAt = createdAt;
    for (const step of steps) {
      // 무임승차자는 초반 4주에 직접 수정 몇 번만 (공동 편집 · 제안 없음) → 교수 화면에 "N일째 변경 없음"
      const pool = step.at > START + 28 * DAY ? active : members;
      const owner = spec.owner && chance(0.45) ? spec.owner : weighted(pool, byLevel);
      const revId = randomUUID();
      // 이 단계 직후 본문
      const textAfter = renderUpTo(steps, step, spec);
      // 제안 모드로 들어온 줄 (작성자 확정) — 추가 단계의 15%
      let suggestion = null;
      if (step.op === "insert" && active.some((m) => m.id !== owner.id) && chance(step.lines.length >= 2 ? 0.45 : 0.25)) {
        const sugAuthor = weighted(active.filter((m) => m.id !== owner.id), byLevel);
        const s = step.lines[step.lines.length - 1];
        suggestion = {
          id: randomUUID(),
          external_doc_id: docId,
          team_id: teamId,
          suggestion_id: `suggest.${randomUUID().slice(0, 12)}`,
          status: "accepted",
          added_text: s,
          removed_text: "",
          text_hash: randomUUID().slice(0, 16),
          first_seen_at: iso(step.at - 50 * 60_000),
          stable_since: iso(step.at - 40 * 60_000),
          author_name: sugAuthor.name,
          author_id: sugAuthor.id,
          suggested_at: iso(step.at - 55 * 60_000),
          chars_added: s.length,
          chars_removed: 0,
          accepted_at: iso(step.at - 5 * 60_000),
        };
        suggestions.push(suggestion);
        pushEvent(events, {
          teamId,
          userId: sugAuthor.id,
          category: spec.category,
          amount: s.length,
          refTable: "external_doc_suggestions",
          refId: suggestion.id,
          at: step.at - 5 * 60_000,
          meta: {
            provider: "google",
            external_doc_id: docId,
            title: spec.title,
            web_url: null,
            source: "suggestion",
            confidence: "exact",
            suggested_at: suggestion.suggested_at,
            chars_added: s.length,
            chars_removed: 0,
          },
        });
      }
      const added = step.op === "insert" ? step.added.length - (suggestion ? suggestion.added_text.length + 1 : 0) : step.added.length;
      const removed = step.op === "edit" ? step.removed.length : 0;
      const shared = chance(0.18) && active.some((m) => m.id !== owner.id);
      const co = shared ? weighted(active.filter((m) => m.id !== owner.id), byLevel) : null;
      const parts = shared
        ? [
            { m: owner, share: 0.65 },
            { m: co, share: 0.35 },
          ]
        : [{ m: owner, share: 1 }];
      revisions.push({
        id: revId,
        external_doc_id: docId,
        team_id: teamId,
        external_revision_id: `${Math.floor(step.at / 1000)}`,
        modified_at: iso(step.at),
        google_permission_id: `perm-${owner.id.slice(0, 8)}`,
        google_display_name: owner.name,
        google_email: emailOf[owner.id],
        author_id: owner.id,
        chars_added: Math.max(added, 0),
        chars_removed: removed,
        text_available: true,
        source: "revision",
        period_start: prevAt ? iso(prevAt) : null,
        attribution_final: true,
        changes:
          step.op === "edit"
            ? [{ op: "replace", line: step.line + 1, removed: step.removed, added: step.added, before: "", after: "" }]
            : step.lines
                .filter((l) => !suggestion || l !== suggestion.added_text)
                .map((l, j) => ({ op: "insert", line: step.line + j + 1, added: l, before: "", after: "" })),
        changes_truncated: 0,
        text_after: textAfter,
      });
      for (const p of parts) {
        const ca = Math.round(Math.max(added, 0) * p.share);
        const cr = Math.round(removed * p.share);
        const creditId = randomUUID();
        credits.push({
          id: creditId,
          revision_id: revId,
          team_id: teamId,
          author_id: p.m.id,
          person_id: `people/${p.m.id.slice(0, 10)}`,
          permission_id: `perm-${p.m.id.slice(0, 8)}`,
          display_name: p.m.name,
          chars_added: ca,
          chars_removed: cr,
          share: p.share,
          confidence: shared ? "shared" : "single",
          edited_from: iso(step.at - (20 + rand() * 60) * 60_000),
          edited_to: iso(step.at - rand() * 5 * 60_000),
        });
        const amount = Math.min(Math.round(ca + 0.5 * cr), 3000);
        if (amount > 0) {
          pushEvent(events, {
            teamId,
            userId: p.m.id,
            category: spec.category,
            amount,
            refTable: "external_doc_credits",
            refId: creditId,
            at: step.at,
            meta: {
              provider: "google",
              external_doc_id: docId,
              title: spec.title,
              web_url: null,
              modified_at: iso(step.at),
              revision_id: revId,
              source: "revision",
              confidence: shared ? "shared" : "single",
              share: p.share,
              chars_added: ca,
              chars_removed: cr,
            },
          });
        }
      }
      notable.push({ at: step.at, actor: owner.id, kind: "document_edited", title: "팀 문서가 수정됐어요", body: spec.title, entity: docId, href: `/lamp/documents/${docId}`, prof: "documents" });
      prevAt = step.at;
      lastAt = step.at;
    }
    const finalText = lines.join("\n");
    extDocs.push({
      id: docId,
      team_id: teamId,
      provider: "google",
      external_id: `demo:${randomUUID().replace(/-/g, "")}`, // demo: 접두사 = 동기화 제외 (src/lib/google/demo.ts)
      title: spec.title,
      mime_type: spec.mime,
      web_url: null,
      linked_by: (spec.owner ?? leader).id,
      last_revision_id: prevAt ? `${Math.floor(prevAt / 1000)}` : null,
      last_text: finalText,
      last_synced_at: iso(Math.min(lastAt + 4 * 60_000, SAFE_NOW)),
      created_at: iso(createdAt),
      snapshot_text: finalText,
      snapshot_at: iso(Math.min(lastAt + 4 * 60_000, SAFE_NOW)),
      blame_base_text: "",
      blame_base_at: iso(createdAt),
    });
  }
  await insertAll("external_docs", extDocs);
  await insertAll("external_doc_revisions", revisions);
  await insertAll("external_doc_credits", credits);
  await insertAll("external_doc_suggestions", suggestions);

  // ----- 태스크 -----
  const templates = TASK_TEMPLATES[team.course];
  const taskRows = [];
  const taskPlan = [];
  const posByStatus = { todo: 0, doing: 0, done: 0 };
  const riderTasks = new Set();
  if (members.some((m) => m.rider)) {
    // 무임승차자: 와이어프레임(완료 · 미확인) + F3 구현(마감 지남, 진행 중에 멈춤)
    riderTasks.add(templates.findIndex((t) => t[2].startsWith("와이어프레임")));
    riderTasks.add(templates.findIndex((t) => t[2].startsWith("F3")));
  }
  templates.forEach(([w, dueDays, title], idx) => {
    const t = title.replace(/\{f(\d)\}/g, (_, n) => featureNames[Number(n)] ?? featureNames[0]);
    const createdAt = Math.min(START + (w * 7 + 1) * DAY + (11 + rand() * 9) * HOUR, SAFE_NOW - 2 * HOUR);
    const due = createdAt + dueDays * DAY;
    const rider = members.find((m) => m.rider);
    const assignee = riderTasks.has(idx) && rider ? rider : chance(0.06) ? null : weighted(active.length ? active : members, byLevel);
    let status;
    if (riderTasks.has(idx) && rider) status = t.startsWith("F3") ? "doing" : "done";
    else if (due < NOW - 0.5 * DAY) status = chance(0.93) ? "done" : "doing";
    else if (createdAt > NOW - 3 * DAY) status = chance(0.5) ? "todo" : "doing";
    else status = chance(0.55) ? "doing" : chance(0.3) ? "done" : "todo";
    if (!assignee && status === "done") status = "todo";
    const creator = weighted(active.length ? active : members, byLevel);
    const id = randomUUID();
    const completedAt = status === "done" ? Math.min(createdAt + dueDays * DAY * (0.45 + rand() * 0.5), SAFE_NOW - HOUR) : null;
    taskRows.push({
      id,
      team_id: teamId,
      title: t,
      description: taskDescription(t, team),
      status,
      position: (posByStatus[status] += 1000),
      assignee_id: assignee?.id ?? null,
      created_by: creator.id,
      due_date: ymd(due),
      created_at: iso(createdAt),
      updated_at: iso(completedAt ?? createdAt),
    });
    const verifier =
      status === "done" && !(riderTasks.has(idx) && rider) && chance(0.82)
        ? weighted(active.filter((m) => m.id !== assignee?.id), byLevel)
        : null;
    taskPlan.push({ id, title: t, createdAt, completedAt, creator: creator.id, assignee: assignee?.id ?? null, verifier: verifier?.id ?? null, week: w, due });
  });
  await insertAll("tasks", taskRows);
  for (const p of taskPlan.filter((p) => p.verifier)) {
    must(await admin.from("tasks").update({ verified_by: p.verifier }).eq("id", p.id), "verify task");
  }
  for (const p of taskPlan.filter((p) => p.completedAt)) {
    notable.push({ at: p.completedAt, actor: p.assignee, kind: "task_status", title: "할 일 상태가 변경됐어요", body: `${nameOf[p.assignee]} · ${p.title} → 완료`, entity: p.id, href: `/lamp/board?task=${p.id}`, prof: "dashboard" });
  }

  // ----- 회의 · 회의록 · 출결 · 댓글 -----
  const topics = team.course === "DB" ? DB_TOPICS : team.course === "IND" ? STUDY_TOPICS : SE_TOPICS;
  const meetingHour = team.course === "DB" ? 15 : team.course === "IND" ? 21 : 19;
  const meetingDay = team.course === "IND" ? 3 : 1;
  const skipWeeks = team.shape[1] < 0.3 ? new Set([1, 2]) : new Set();
  const meetingRows = [];
  for (let w = 0; w < 10; w++) {
    if (skipWeeks.has(w)) continue;
    const heldAt = START + (w * 7 + meetingDay) * DAY + meetingHour * HOUR;
    if (heldAt > NOW + 15 * DAY) break;
    const loc = team.course === "IND" ? "Discord" : w === 4 || w === 9 ? "공학관 301호" : LOCATIONS[(w + team.key.charCodeAt(0)) % LOCATIONS.length];
    meetingRows.push({ id: randomUUID(), team_id: teamId, title: `${w + 1}주차 · ${topics[w]}`, held_at: iso(heldAt), location: loc, created_by: weighted(active, byLevel).id, week: w, heldAt });
  }
  const futureMeetings = meetingRows.filter((m) => m.heldAt > NOW).slice(0, 2);
  const keptMeetings = [...meetingRows.filter((m) => m.heldAt <= NOW), ...futureMeetings];
  await insertAll(
    "meetings",
    keptMeetings.map(({ id, team_id, title, held_at, location, created_by, heldAt }) => ({ id, team_id, title, held_at, location, created_by, created_at: iso(Math.min(heldAt - 3 * DAY, SAFE_NOW - DAY)) })),
  );
  const noteDocs = must(await admin.from("meetings").select("id, document_id").eq("team_id", teamId), "meeting docs");
  const docByMeeting = Object.fromEntries(noteDocs.map((m) => [m.id, m.document_id]));
  const attendanceTimes = {};
  for (const m of keptMeetings.filter((m) => m.heldAt <= NOW)) {
    // 출결
    const status = {};
    for (const mem of members) {
      let s = chance(mem.att) ? (chance(mem.late) ? "late" : "present") : chance(0.35) ? "excused" : "absent";
      status[mem.id] = s;
    }
    const scribe = weighted(members.filter((x) => status[x.id] === "present" || status[x.id] === "late"), byLevel) ?? leader;
    const checker = scribe;
    const other = members.find((x) => x.id !== scribe.id && (status[x.id] === "present" || status[x.id] === "late")) ?? members.find((x) => x.id !== scribe.id);
    for (const mem of members) {
      const by = mem.id === checker.id ? other : checker;
      const client = await as(by.id);
      must(
        await client.from("meeting_attendance").update({ status: status[mem.id] }).eq("meeting_id", m.id).eq("user_id", mem.id),
        "attendance",
      );
      if (status[mem.id] === "excused" || (status[mem.id] === "absent" && chance(0.5))) {
        const reason = pick(["아르바이트 일정이 겹쳐서 불참합니다 🙏", "병원 진료로 불참, 회의록 확인할게요", "다른 과목 시험 준비로 빠집니다", "교통 문제로 참석 못 했어요"]);
        must(
          await admin.from("meeting_attendance").update({ comment: reason }).eq("meeting_id", m.id).eq("user_id", mem.id),
          "attendance comment",
        );
      }
    }
    attendanceTimes[m.id] = m.heldAt;
    // 회의록
    const present = members.filter((x) => status[x.id] === "present" || status[x.id] === "late");
    const actions = taskPlan.filter((p) => p.week === m.week || p.week === m.week + 1).slice(0, 4);
    const note = meetingNote(m, team, present, members, status, actions, featureNames, topics);
    const noteAt = m.heldAt + (1.2 + rand()) * HOUR;
    const docId = docByMeeting[m.id];
    const content = { type: "doc", content: note.split("\n").map((line) => ({ type: "paragraph", ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
    must(
      await admin.from("documents").update({ content, content_text: note, version: 2, updated_by: scribe.id, updated_at: iso(noteAt) }).eq("id", docId),
      "meeting note",
    );
    const revId = randomUUID();
    must(
      await admin.from("document_revisions").insert({
        id: revId,
        document_id: docId,
        team_id: teamId,
        author_id: scribe.id,
        version: 2,
        content,
        content_text: note,
        chars_added: note.length,
        chars_removed: 0,
        pasted_chars: 0,
        created_at: iso(noteAt),
        updated_at: iso(noteAt),
      }),
      "note revision",
    );
    pushEvent(events, {
      teamId,
      userId: scribe.id,
      category: "meeting",
      type: "meeting_note",
      amount: note.length,
      refTable: "document_revisions",
      refId: revId,
      at: noteAt,
      meta: { document_id: docId, document_title: `회의록 · ${m.title}`, chars_added: note.length, chars_removed: 0, pasted_chars: 0 },
    });
    // 댓글
    const nComments = Math.floor(rand() * 3) + (m.week >= 6 ? 1 : 0);
    const commentRows = [];
    for (let c = 0; c < nComments; c++) {
      const author = weighted(active, byLevel);
      const at = Math.min(noteAt + (0.5 + rand() * 30) * HOUR, SAFE_NOW - 30 * 60_000);
      commentRows.push({ meeting_id: m.id, team_id: teamId, author_id: author.id, body: pick(COMMENTS), created_at: iso(at), updated_at: iso(at) });
      notable.push({ at, actor: author.id, kind: "meeting_comment", title: "회의에 새 댓글이 달렸어요", body: m.title, entity: m.id, href: `/lamp/meetings?meeting=${m.id}`, prof: "meetings" });
    }
    if (commentRows.length) await insertAll("meeting_comments", commentRows);
  }
  for (const m of futureMeetings) {
    notable.push({ at: Math.min(m.heldAt - 3 * DAY, SAFE_NOW - DAY), actor: leader.id, kind: "meeting_created", title: "새 회의가 잡혔어요", body: `${m.title} · ${fmtDate(m.heldAt)} ${meetingHour}:00`, entity: m.id, href: `/lamp/meetings?meeting=${m.id}`, prof: "meetings" });
  }

  // ----- 파일 (버전) -----
  const fileSpecs = buildFileSpecs(team, isDB);
  const fileRows = [];
  const versionRows = [];
  for (const f of fileSpecs) {
    const fileId = randomUUID();
    const owner = weighted(active, byLevel);
    let prev = "";
    let latest = 0;
    let firstAt = null;
    let lastAt = null;
    const vTimes = f.weeks.map((w) => timeInWindow(w, w, team)).sort((a, b) => a - b);
    for (let v = 0; v < f.weeks.length; v++) {
      const uploader = v === 0 ? owner : weighted(active, byLevel);
      const body = f.content(v, team, members);
      const at = vTimes[v];
      const path = `${teamId}/${randomUUID()}.${f.ext}`;
      const up = await admin.storage.from("team-files").upload(path, new Blob([body], { type: f.mime }), { contentType: f.mime, upsert: true });
      if (up.error) throw new Error(`upload ${f.name}: ${up.error.message}`);
      const added = Math.max(body.length - prev.length, 0) + (v ? Math.floor(rand() * 40) : 0);
      const removed = v ? Math.floor(rand() * 60) : 0;
      const versionId = randomUUID();
      versionRows.push({
        id: versionId,
        file_id: fileId,
        team_id: teamId,
        version: v + 1,
        uploader_id: uploader.id,
        storage_path: path,
        mime_type: f.mime,
        size_bytes: Buffer.byteLength(body),
        extracted_text: body,
        chars_added: added,
        chars_removed: removed,
        change_summary: {},
        created_at: iso(at),
      });
      pushEvent(events, {
        teamId,
        userId: uploader.id,
        category: "file",
        type: "file_version",
        amount: Math.round(added + 0.5 * removed),
        refTable: "file_versions",
        refId: versionId,
        at,
        meta: { file_id: fileId, file_name: f.name, version: v + 1, first: v === 0, chars_added: added, chars_removed: removed },
      });
      notable.push({ at, actor: uploader.id, kind: "file_uploaded", title: "새 파일 버전이 올라왔어요", body: `${f.name} · 버전 ${v + 1}`, entity: fileId, href: "/lamp/files", prof: "dashboard" });
      prev = body;
      latest = v + 1;
      firstAt ??= at;
      lastAt = at;
    }
    fileRows.push({ id: fileId, team_id: teamId, name: f.name, extension: f.ext, latest_version: latest, created_by: owner.id, created_at: iso(firstAt), updated_at: iso(lastAt) });
  }
  await insertAll("files", fileRows);
  await insertAll("file_versions", versionRows);

  // ----- 직접 만든 이벤트 넣기 + 트리거가 만든 이벤트(태스크 · 출석) 시각 맞추기 -----
  await insertAll("activity_events", events);
  const auto = must(
    await admin.from("activity_events").select("*").eq("team_id", teamId).in("ref_table", ["tasks", "meetings"]),
    "auto events",
  );
  const planById = Object.fromEntries(taskPlan.map((p) => [p.id, p]));
  for (const e of auto) {
    if (e.type === "task_create") e.created_at = iso(planById[e.ref_id]?.createdAt ?? NOW);
    else if (e.type === "task_complete") e.created_at = iso(planById[e.ref_id]?.completedAt ?? NOW);
    else if (e.type === "meeting_attend") e.created_at = iso((attendanceTimes[e.ref_id] ?? NOW) + 2 * HOUR);
  }
  if (auto.length) await upsertAll("activity_events", auto, "id");

  // ----- 👍 (최근 4주 활동 중 일부) -----
  const allEvents = must(await admin.from("activity_events").select("id, user_id, created_at").eq("team_id", teamId), "events");
  const kudosRows = [];
  for (const e of allEvents) {
    const at = Date.parse(e.created_at);
    if (at < NOW - 28 * DAY || !chance(0.2)) continue;
    const givers = active.filter((m) => m.id !== e.user_id);
    const n = chance(0.3) ? 2 : 1;
    for (const g of givers.sort(() => rand() - 0.5).slice(0, n)) {
      const kAt = Math.min(at + (1 + rand() * 20) * HOUR, SAFE_NOW - 10 * 60_000);
      kudosRows.push({ event_id: e.id, giver_id: g.id, team_id: teamId, created_at: iso(kAt) });
      notable.push({ at: kAt, actor: g.id, kind: "kudos", title: "내 활동에 공감을 받았어요", body: "팀원이 내 활동에 공감을 남겼어요.", entity: e.id, href: "/lamp/activities", prof: null, to: e.user_id });
    }
  }
  if (kudosRows.length) await insertAll("kudos", kudosRows);

  // ----- 상호평가 (기존 방식 — 활동 데이터와 비교용) -----
  const reviews = [];
  const dominant = team.key === "C" ? members[0] : null;
  for (const r of members) {
    for (const e of members) {
      if (r.id === e.id) continue;
      let score = e.level > 0.7 ? (chance(0.6) ? 5 : 4) : chance(0.5) ? 4 : 3;
      if (e.rider) score = 5; // 미안해서(혹은 갈등이 싫어서) 후하게 주는 상호평가
      if (r.rider) score = 5;
      // 3팀: 다들 "똑같이 4점" — 실제로는 강민서 혼자 캐리
      if (dominant) score = 4;
      reviews.push({
        team_id: teamId,
        reviewer_id: r.id,
        reviewee_id: e.id,
        score,
        comment: score >= 5 ? "항상 먼저 나서서 정리해 줘서 고마워요." : score === 4 ? "맡은 일은 잘 해 줬어요." : "조금 더 적극적으로 참여해 주면 좋겠어요.",
        created_at: iso(NOW - 2 * DAY - rand() * DAY),
      });
    }
  }
  await insertAll("peer_reviews", reviews);

  let notifCount = 0;
  // ----- 알림: 시드 중 트리거가 쏟아낸 것은 지우고, 최근 10일 활동으로 다시 만든다 (마감 · 회의 리마인더는 유지) -----
  if (HAS_NOTIFICATIONS) {
  must(
    await admin.from("notifications").delete().eq("team_id", teamId).not("kind", "in", "(meeting_day,meeting_hour,task_due_day,task_due_today)"),
    "clear notifications",
  );
  const recent = notable.filter((n) => n.at > NOW - 10 * DAY && n.at < NOW).sort((a, b) => b.at - a.at);
  const seen = new Set();
  const notiRows = [];
  for (const n of recent) {
    const dedupe = `${n.kind}:${n.entity}:${n.actor}:${ymd(n.at)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const recipients = n.to
      ? [{ id: n.to, prof: false }]
      : [
          ...members.filter((m) => m.id !== n.actor).map((m) => ({ id: m.id, prof: false })),
          ...(isClass && n.prof ? [{ id: PROF_ID, prof: true }] : []),
        ];
    for (const r of recipients) {
      if (r.id === n.actor) continue;
      const read = n.at < NOW - 1.5 * DAY || (r.prof && n.at < NOW - 0.5 * DAY);
      notiRows.push({
        recipient_id: r.id,
        team_id: teamId,
        actor_id: n.actor,
        entity_id: n.entity,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: r.prof ? `/professor/teams/${teamId}/${n.prof}` : n.href,
        available_at: iso(n.at),
        created_at: iso(n.at),
        read_at: read ? iso(n.at + 2 * HOUR) : null,
      });
    }
  }
  // 받는 사람마다 최근 30개까지만
  const perRecipient = {};
  const trimmed = notiRows.filter((r) => (perRecipient[r.recipient_id] = (perRecipient[r.recipient_id] ?? 0) + 1) <= 30);
  await insertAll("notifications", trimmed);
  notifCount = trimmed.length;
  }

  summary.push({
    팀: team.name,
    문서: extDocs.length,
    수정기록: revisions.length,
    제안: suggestions.length,
    태스크: taskRows.length,
    회의: keptMeetings.length,
    파일버전: versionRows.length,
    이벤트: allEvents.length,
    "👍": kudosRows.length,
    알림: HAS_NOTIFICATIONS ? notifCount : "-",
  });
  console.log(`✓ ${team.name}`);
}

console.table(summary);
for (const c of COURSES.filter((c) => c.inviteCode)) console.log(`과목 초대코드 · ${c.name}: ${c.inviteCode}`);
console.log("\n데모 로그인: 로그인 화면 '교수로 체험' (professor@demo.lamp) · '학생으로 체험' (student1@demo.lamp · 이서연)");
console.log("다른 학생으로 보려면 studentN@demo.lamp + DEMO_PASSWORD (예: student4 = 무임승차 정민재)");

// ============================================================
// 헬퍼: 이벤트 · 문서 본문 · 파일 · 회의록
// ============================================================
function pushEvent(list, { teamId, userId, category, type = "external_doc_edit", amount, refTable, refId, at, meta }) {
  list.push({
    team_id: teamId,
    user_id: userId,
    category,
    type,
    amount,
    ref_table: refTable,
    ref_id: refId,
    meta,
    created_at: iso(at),
  });
}

function renderUpTo(steps, upto, spec) {
  // steps를 순서대로 다시 적용해 upto 직후 본문을 만든다
  const lines = [];
  for (const s of steps) {
    if (s.op === "insert") lines.push(...s.lines);
    else lines[s.line] = s.added;
    if (s === upto) break;
  }
  void spec;
  return lines.join("\n");
}

function polish(line) {
  if (!line || line.length < 12 || /\(|—/.test(line.slice(-12))) return line;
  return line + pick(POLISH);
}

function buildDocSpecs(team, members, isDB) {
  const names = members.map((m) => m.name);
  const roles = isDB ? DB_ROLES : ROLES;
  const f = team.features;
  const DOC = "application/vnd.google-apps.document";
  const SLIDES = "application/vnd.google-apps.presentation";
  const SHEET = "application/vnd.google-apps.spreadsheet";
  if (team.light) {
    return [
      {
        title: "풀이 노트 · 오답 정리",
        mime: DOC,
        category: "document",
        window: [0, 8],
        lines: [
          "알고리즘 스터디 풀이 노트",
          "규칙: 주 2회 · 문제당 40분 제한 · 풀이는 다음 날까지 공유",
          ...f.flatMap(([n, d], i) => [
            `${i + 1}. ${n} — ${d}`,
            `  핵심 아이디어: ${pick(["방문 배열로 중복 방문 방지", "점화식부터 정의하고 초기값 확인", "lo/hi 경계 조건을 먼저 손으로 검증", "우선순위 큐에 (거리, 정점) 순서로 넣기"])}`,
            `  자주 틀린 점: ${pick(["인덱스 범위", "오버플로 (long 사용)", "입력 크기 대비 시간 복잡도", "초기화 누락"])}`,
          ]),
          "다음 목표: 백준 골드 문제 주 5개",
        ],
      },
    ];
  }
  const fr = f.flatMap(([n, d], i) => [
    `FR-0${i + 1} ${n}: ${d}.`,
    `  · 우선순위: ${i < 3 ? "Must" : i < 5 ? "Should" : "Could"} / 수용 기준: ${n} 요청 후 3초 이내에 결과를 보여 준다.`,
  ]);
  const req = {
    title: isDB ? `${team.project} 요구사항 · ERD 명세서` : `${team.project} 요구사항 명세서`,
    mime: DOC,
    category: "document",
    window: isDB ? [0, 4] : [1, 6],
    lines: [
      isDB ? `${team.project} 요구사항 · ERD 명세서` : `${team.project} 요구사항 명세서 (SRS)`,
      "1. 개요",
      `${team.project}는 ${team.pitch}이다.`,
      "본 문서는 팀 프로젝트의 기능 · 비기능 요구사항과 수용 기준을 정의한다.",
      "2. 이해관계자",
      "- 주 사용자: 교내 재학생 (학부생 · 대학원생)",
      "- 운영자: 학생회 및 관련 행정 부서",
      `- 개발팀: ${names.join(", ")}`,
      "3. 기능 요구사항",
      ...fr,
      "4. 비기능 요구사항",
      "NFR-01 성능: 주요 화면은 모바일 환경에서 2초 이내에 표시한다.",
      "NFR-02 보안: 학교 Google 계정으로만 로그인하고 개인정보는 암호화해 저장한다.",
      "NFR-03 가용성: 학기 중 99% 이상 가동을 목표로 한다.",
      "NFR-04 접근성: WCAG 2.1 AA 명도 대비 기준을 지킨다.",
      ...(isDB
        ? [
            "5. 엔티티 정의",
            ...f.map(([n], i) => `E${i + 1}. ${n} 관련 엔티티 — PK는 bigint identity, 생성 · 수정 시각 컬럼 공통`),
            "6. 관계 및 제약",
            "- 회원(1) : 예약/거래(N), 외래키 ON DELETE RESTRICT",
            "- 상태 값은 CHECK 제약으로 허용 값만 받는다",
          ]
        : [
            "5. 유스케이스",
            ...f.slice(0, 4).map(([n], i) => `UC-0${i + 1} ${n} — 액터: 학생 / 기본 흐름: 메뉴 진입 → 조건 입력 → 결과 확인 / 예외: 네트워크 오류 시 재시도 안내`),
            "6. 제약 사항 및 가정",
            "- 개발 기간은 14주이며 모바일 웹(PWA)을 우선 개발한다.",
            "- 학사 데이터는 공개 API가 없어 샘플 데이터로 대체한다.",
          ]),
    ],
  };
  const plan = {
    title: isDB ? `${team.project} 최종 보고서` : `${team.project} 프로젝트 기획서`,
    mime: DOC,
    category: "document",
    window: isDB ? [5, 8] : [0, 8],
    owner: members[team.lead] ?? members[0],
    lines: [
      isDB ? `${team.project} 데이터베이스 설계 최종 보고서` : `${team.project} 프로젝트 기획서`,
      "1. 배경 및 문제 정의",
      `교내 설문(응답 84명) 결과, 응답자의 71%가 "${f[0][0]}" 과정에서 불편을 겪는다고 답했다.`,
      `기존에는 단톡방 · 커뮤니티 게시판으로 해결했지만 정보가 흩어지고 신뢰하기 어렵다.`,
      "2. 목표",
      `- ${team.pitch} 개발`,
      "- 학기 말까지 베타 사용자 50명 확보, 핵심 기능 만족도 4.0/5 이상",
      "3. 타깃 사용자",
      "- 페르소나 A: 2학년 · 전공 수업이 많고 시간표가 빡빡한 학생",
      "- 페르소나 B: 편입생 · 교내 인맥이 적어 정보를 얻기 어려운 학생",
      "4. 핵심 기능",
      ...f.map(([n, d]) => `- ${n}: ${d}`),
      "5. 일정",
      "- 1~3주차: 주제 확정 · 요구사항 도출 / 4~6주차: 설계 · 중간발표",
      "- 7~11주차: 구현 스프린트 (2주 단위) / 12~14주차: 테스트 · 최종발표",
      "6. 역할 분담",
      ...members.map((m, i) => `- ${m.name}: ${roles[i % roles.length]}`),
      "7. 리스크 및 대응",
      "- 일정 지연: 매주 회의에서 보드 진행률 점검, 2주 연속 지연 시 범위 축소",
      "- 기술 리스크: 낯선 라이브러리는 1주차에 PoC로 먼저 검증",
      "8. 기대 효과",
      `- ${f[1][0]} · ${f[2][0]} 기능으로 학생들의 시간과 비용을 줄인다.`,
    ],
  };
  const slides = {
    title: isDB ? "중간 점검 발표 슬라이드" : "중간발표 슬라이드",
    mime: SLIDES,
    category: "file",
    window: [4, 5],
    lines: [
      `슬라이드 1 · 표지 — ${team.project} (${team.name})`,
      `슬라이드 2 · 문제 정의 — 설문 84명 중 71%가 불편을 경험`,
      `슬라이드 3 · 솔루션 — ${team.pitch}`,
      ...f.slice(0, 4).map(([n, d], i) => `슬라이드 ${i + 4} · ${n} — ${d}`),
      `슬라이드 8 · ${isDB ? "ERD" : "시스템 아키텍처"} — ${isDB ? "엔티티 7개 · 관계 9개, 3NF까지 정규화" : "Next.js · Supabase · Vercel, 인증은 Google OAuth"}`,
      "슬라이드 9 · 진행 현황 — 요구사항 100%, 설계 80%, 구현 20%",
      "슬라이드 10 · 남은 일정 — 구현 스프린트 3회 · 사용자 테스트 1회",
      "슬라이드 11 · 역할 분담 — " + members.map((m) => m.name).join(" · "),
      "슬라이드 12 · Q&A",
    ],
  };
  const tasks = TASK_TEMPLATES[team.course];
  const sheet = {
    title: "WBS · 일정표",
    mime: SHEET,
    category: "file",
    window: [0, 8],
    lines: [
      "주차\t작업\t담당\t상태",
      ...tasks.map(([w, , t], i) => `${w + 1}주차\t${t.replace(/\{f(\d)\}/g, (_, n) => f[Number(n)]?.[0] ?? f[0][0])}\t${members[i % members.length].name}\t${w <= 6 ? "완료" : "진행 중"}`),
    ],
  };
  return [req, plan, slides, sheet];
}

function buildFileSpecs(team, isDB) {
  const f = team.features;
  if (team.light) {
    return [
      {
        name: "풀이_코드_모음.md",
        ext: "md",
        mime: "text/markdown",
        weeks: [1, 3, 5, 7],
        content: (v) =>
          ["# 풀이 코드 모음", ...f.slice(0, v + 1).flatMap(([n], i) => [`\n## ${i + 1}. ${n}`, "```python", "def solve():", "    # TODO: 핵심 아이디어 주석", "    pass", "```"])].join("\n"),
      },
    ];
  }
  if (isDB) {
    return [
      {
        name: "schema.sql",
        ext: "sql",
        mime: "text/plain",
        weeks: [3, 5, 6, 7],
        content: (v) =>
          [
            `-- ${team.project} 스키마 v${v + 1}`,
            "create table member (id bigint generated always as identity primary key, student_no text unique not null, name text not null);",
            ...f.slice(0, v + 2).map(([n], i) => `-- ${n}\ncreate table t${i + 1} (id bigint generated always as identity primary key, member_id bigint references member(id), status text check (status in ('active','done')), created_at timestamptz default now());`),
            v >= 2 ? "create index on t1 (member_id, created_at desc);" : "",
          ].join("\n"),
      },
      {
        name: "쿼리_실행계획_분석.md",
        ext: "md",
        mime: "text/markdown",
        weeks: [6, 7],
        content: (v) =>
          [`# 쿼리 실행 계획 분석 v${v + 1}`, "| 쿼리 | 튜닝 전 | 튜닝 후 | 방법 |", "|---|---|---|---|", "| 좌석 현황 조회 | 182ms | 9ms | 복합 인덱스 |", ...(v ? ["| 이용 통계 | 1.4s | 120ms | 집계 뷰 + 부분 인덱스 |"] : [])].join("\n"),
      },
      {
        name: "테스트데이터_생성.py",
        ext: "py",
        mime: "text/plain",
        weeks: [7],
        content: () => ["# 테스트 데이터 1만 건 생성", "import random", "for i in range(10_000):", "    print(f\"insert into member (student_no, name) values ('2026{i:05d}', '학생{i}');\")"].join("\n"),
      },
    ];
  }
  return [
    {
      name: "사용자_인터뷰_결과.md",
      ext: "md",
      mime: "text/markdown",
      weeks: [1, 2],
      content: (v) =>
        [
          `# 사용자 인터뷰 결과 (${v ? "최종" : "초안"})`,
          "- 대상: 재학생 5명 (1~4학년)",
          ...f.slice(0, 3 + v * 2).map(([n], i) => `- 인터뷰 ${i + 1}: "${n}" 기능이 있으면 ${pick(["매주 쓸 것 같다", "친구에게 추천하겠다", "지금 쓰는 방법보다 훨씬 편하겠다"])}`),
          v ? "\n## 인사이트\n1. 신뢰할 수 있는 정보가 가장 중요\n2. 알림은 꼭 필요한 것만" : "",
        ].join("\n"),
    },
    {
      name: "API_명세서.md",
      ext: "md",
      mime: "text/markdown",
      weeks: [4, 5, 6, 7],
      content: (v) =>
        [`# ${team.project} API 명세 v0.${v + 1}`, ...f.slice(0, 2 + v).map(([n], i) => `\n## ${i + 1}. ${n}\n- \`GET /api/v1/${["match", "groups", "check-in", "schedule", "logs", "badges", "alerts"][i] ?? "items"}\`\n- 응답: 200 { data: [...] } / 401 인증 필요`)].join("\n"),
    },
    {
      name: "중간발표_대본.txt",
      ext: "txt",
      mime: "text/plain",
      weeks: [4, 4, 5],
      content: (v) =>
        [`[중간발표 대본 v${v + 1}]`, `안녕하세요, ${team.name}입니다.`, `저희는 ${team.pitch}를 만들고 있습니다.`, ...f.slice(0, 2 + v).map(([n, d]) => `${n}: ${d}.`), v >= 2 ? "질문 대비: 경쟁 서비스와의 차별점은 교내 인증 기반 신뢰도입니다." : ""].join("\n"),
    },
    {
      name: "테스트_케이스.csv",
      ext: "csv",
      mime: "text/csv",
      weeks: [7, 8],
      content: (v) =>
        ["ID,기능,시나리오,기대 결과,상태", ...f.slice(0, 3 + v * 2).map(([n], i) => `TC-${String(i + 1).padStart(2, "0")},${n},정상 입력,성공 메시지 표시,${v ? "통과" : "미실행"}`)].join("\n"),
    },
  ];
}

function taskDescription(title, team) {
  if (/구현/.test(title)) return `요구사항 명세서의 해당 FR 수용 기준을 만족하도록 구현하고 PR로 리뷰 요청하기.`;
  if (/슬라이드|발표/.test(title)) return `${team.project} 발표 흐름: 문제 → 솔루션 → 데모 → 일정. 10분 이내.`;
  if (/인터뷰/.test(title)) return "질문지 10문항, 녹음 동의 받고 결과는 파일 보관함에 정리.";
  return null;
}

function meetingNote(m, team, present, members, status, actions, featureNames, topics) {
  const label = { present: "출석", late: "지각", absent: "결석", excused: "사유 불참" };
  const absent = members.filter((x) => !present.includes(x));
  const lines = [
    `[${topics[m.week]}] ${fmtDate(m.heldAt)} · ${m.location}`,
    `참석: ${present.map((x) => (status[x.id] === "late" ? `${x.name}(지각)` : x.name)).join(", ")}`,
    absent.length ? `불참: ${absent.map((x) => `${x.name}(${label[status[x.id]]})`).join(", ")}` : "",
    "",
    "안건",
    `1. 지난주 액션 아이템 점검 — 보드 기준 진행률 확인`,
    `2. ${topics[m.week]} 관련 논의`,
    `3. ${pick(featureNames)} 범위와 우선순위 재확인`,
    "",
    "결정 사항",
    `- ${pick(featureNames)}은(는) 이번 주까지 초안을 완성하고 다음 회의에서 리뷰한다.`,
    `- 문서는 구글 문서 제안 모드로 수정하고, 팀장이 매일 밤 승인한다.`,
    "",
    "액션 아이템",
    ...actions.map((a) => `- ${a.assignee ? nameOf[a.assignee] : "미정"}: ${a.title} (마감 ${fmtDate(a.due)})`),
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n").trim();
}
