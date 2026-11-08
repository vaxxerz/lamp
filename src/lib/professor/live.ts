// 교수 화면 실데이터 — 로그인한 교수의 담당 과목(kind = 'class')과 그 팀들의 기록을 Supabase에서 읽는다.
//  권한은 RLS가 보장한다: 교수는 자기 과목(courses.professor_id = 본인)의 팀 · 문서 · 회의만 읽을 수 있다.
//  아래 필터는 화면을 위한 것이지 보안 경계가 아니다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProfessorEvents } from "./activity-events";
import {
  buildDocumentsAndActivities,
  type DocRow,
  type RevisionRow,
  type SuggestionRow,
} from "@/lib/student/live";
import type { AttendanceStatus, User } from "@/lib/student/types";
import { ProfessorAccessError } from "./scope";
import type { ProfessorData, ProfessorMeeting, ProfessorTeam } from "./types";

const cleanName = (s: string | null | undefined) =>
  s ? s.replace(/[­​-‏]/g, "") : null;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}


export async function loadProfessorLive(
  supabase: SupabaseClient,
): Promise<ProfessorData> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new ProfessorAccessError("로그인이 필요합니다.");
  const me = must(
    await supabase
      .from("profiles")
      .select("id, name, role")
      .eq("id", uid)
      .maybeSingle(),
  ) as { id: string; name: string; role: string } | null;
  if (!me || me.role !== "professor")
    throw new ProfessorAccessError("교수 계정만 볼 수 있습니다.");

  const courses = must(
    await supabase
      .from("courses")
      .select("id, name, semester, invite_code, created_at")
      .eq("professor_id", uid)
      .eq("kind", "class")
      .order("created_at", { ascending: false }),
  ) as {
    id: string;
    name: string;
    semester: string;
    invite_code: string;
  }[];
  const courseIds = courses.map((c) => c.id);

  const teamRows = courseIds.length
    ? (must(
        await supabase
          .from("teams")
          .select("id, course_id, name, invite_code, created_at")
          .in("course_id", courseIds)
          .order("created_at"),
      ) as {
        id: string;
        course_id: string;
        name: string;
        invite_code: string | null;
      }[])
    : [];
  const teamIds = teamRows.map((t) => t.id);

  const empty = { data: [], error: null };
  const [members, docs, suggestions, revisions, meetings, events] = teamIds.length
    ? await Promise.all([
        supabase
          .from("team_members")
          .select("team_id, user_id, joined_at")
          .in("team_id", teamIds)
          .order("joined_at"),
        supabase
          .from("external_docs")
          .select(
            "id, team_id, external_id, title, mime_type, web_url, last_synced_at",
          )
          .in("team_id", teamIds)
          .order("created_at"),
        supabase
          .from("external_doc_suggestions")
          .select(
            "id, team_id, external_doc_id, added_text, removed_text, author_id, author_name, suggested_at, accepted_at",
          )
          .in("team_id", teamIds)
          .eq("status", "accepted")
          .order("accepted_at", { ascending: false })
          .limit(1000),
        supabase
          .from("external_doc_revisions")
          .select(
            "id, team_id, external_doc_id, modified_at, author_id, google_display_name, chars_added, chars_removed, changes, credits:external_doc_credits(author_id, display_name, share, edited_from, edited_to)",
          )
          .in("team_id", teamIds)
          .order("modified_at", { ascending: false })
          .limit(1000),
        supabase
          .from("meetings")
          .select(
            "id, team_id, title, held_at, location, note:documents(content_text), attendance:meeting_attendance(user_id, status, checked_by, checked_at)",
          )
          .in("team_id", teamIds)
          .order("held_at", { ascending: false }),
        loadProfessorEvents(supabase, teamIds),
      ])
    : [empty, empty, empty, empty, empty, empty];
  const memberRows = must(members) as {
    team_id: string;
    user_id: string;
  }[];

  // 팀원 프로필 (같은 과목의 교수는 RLS로 열람 가능)
  const userIds = [...new Set(memberRows.map((m) => m.user_id))];
  const profiles = userIds.length
    ? (must(
        await supabase
          .from("profiles")
          .select("id, name, email")
          .in("id", userIds),
      ) as { id: string; name: string; email: string | null }[])
    : [];
  const users: User[] = userIds.map((id) => {
    const p = profiles.find((x) => x.id === id);
    return {
      id,
      name: cleanName(p?.name) ?? "학생",
      email: p?.email ?? "",
    };
  });

  const teams: ProfessorTeam[] = teamRows.map((t) => ({
    id: t.id,
    courseId: t.course_id,
    name: t.name,
    createdBy: null,
    inviteCode: t.invite_code,
    // 학생 화면과 같은 규칙: 가장 먼저 들어온 팀원을 팀장으로 표시
    members: memberRows
      .filter((m) => m.team_id === t.id)
      .map((m, i) => ({
        userId: m.user_id,
        role: i === 0 ? ("leader" as const) : ("member" as const),
      })),
  }));

  const docRows = must(docs) as (DocRow & { team_id: string })[];
  const suggestionRows = must(suggestions) as (SuggestionRow & {
    team_id: string;
  })[];
  const revisionRows = must(revisions) as (RevisionRow & {
    team_id: string;
  })[];
  const documents: ProfessorData["documents"] = [];
  const activities: ProfessorData["activities"] = [];
  for (const t of teams) {
    const teamUsers = users.filter((u) =>
      t.members.some((m) => m.userId === u.id),
    );
    const built = buildDocumentsAndActivities(
      t.id,
      docRows.filter((d) => d.team_id === t.id),
      suggestionRows.filter((s) => s.team_id === t.id),
      revisionRows.filter((r) => r.team_id === t.id),
      teamUsers,
    );
    documents.push(...built.documents);
    activities.push(...built.activities);
  }
  activities.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const meetingList: ProfessorMeeting[] = (
    must(meetings) as unknown as {
      id: string;
      team_id: string;
      title: string;
      held_at: string;
      location: string | null;
      note: { content_text: string } | null;
      attendance: {
        user_id: string;
        status: AttendanceStatus;
        checked_by: string | null;
        checked_at: string | null;
      }[];
    }[]
  ).map((m) => {
    const team = teams.find((t) => t.id === m.team_id);
    const rows = m.attendance ?? [];
    return {
      id: m.id,
      teamId: m.team_id,
      title: m.title,
      heldAt: m.held_at,
      location: m.location ?? "",
      notes: m.note?.content_text ?? "",
      attendance: Object.fromEntries(
        (team?.members ?? []).map((tm) => [
          tm.userId,
          rows.find((r) => r.user_id === tm.userId)?.status ?? "unchecked",
        ]),
      ),
      confirmations: Object.fromEntries(
        rows
          .filter((r) => r.checked_by && r.checked_at)
          .map((r) => [
            r.user_id,
            { userId: r.checked_by!, at: r.checked_at! },
          ]),
      ),
    };
  });

  return {
    mode: "live",
    professor: {
      id: me.id,
      name: cleanName(me.name) ?? "교수",
      role: "professor",
    },
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      professorId: uid,
      inviteCode: c.invite_code,
      semester: c.semester,
    })),
    teams,
    users,
    documents,
    activities,
    meetings: meetingList,
    events: must(events).map((event) => ({ teamId: event.team_id, userId: event.user_id, category: event.category, createdAt: event.created_at })),
  };
}

// ---------- 쓰기 (RLS · RPC가 담당 교수인지 다시 검사) ----------
export async function createLiveCourse(
  supabase: SupabaseClient,
  professorId: string,
  name: string,
  semester: string,
) {
  const { error } = await supabase
    .from("courses")
    .insert({
      professor_id: professorId,
      name: name.trim(),
      semester,
      kind: "class",
    });
  if (error) throw new Error(error.message);
}

export async function createLiveTeam(
  supabase: SupabaseClient,
  courseId: string,
  name: string,
) {
  const { error } = await supabase.rpc("create_team", {
    p_course_id: courseId,
    p_name: name.trim(),
  });
  if (error) throw new Error(error.message);
}
