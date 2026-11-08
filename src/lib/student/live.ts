// /lamp 실데이터 계층 — 로그인한 학생의 팀 데이터를 Supabase에서 읽고 쓴다 (RLS가 권한을 보장)
//  기여 기록 = 구글 제안(작성자 확인됨) + 구글 revision · 스냅샷 구간(작성자 추정 / 미확인)
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_EXTERNAL_ID_PREFIX } from "@/lib/google/demo";
import type {
  ActivityEvent,
  AttendanceStatus,
  ChangeFragment,
  ConnectedDocument,
  ContributionActivity,
  ContributionScore,
  Meeting,
  Task,
  TaskStatus,
  TeamSummary,
  TeamTrack,
  TeamFile,
  User,
  Workspace,
} from "./types";

const MIME_TYPE: Record<string, ConnectedDocument["type"]> = {
  "application/vnd.google-apps.document": "docs",
  "application/vnd.google-apps.presentation": "slides",
  "application/vnd.google-apps.spreadsheet": "sheets",
};
const URL_PATH: Record<ConnectedDocument["type"], string> = {
  docs: "document",
  slides: "presentation",
  sheets: "spreadsheets",
};

type Credit = {
  author_id: string | null;
  display_name: string | null;
  share: number;
  edited_from: string | null;
  edited_to: string | null;
};
/** 구글 표시 이름에 섞여 오는 soft hyphen 등 보이지 않는 문자 제거 */
const cleanName = (s: string | null) =>
  s ? s.replace(/[\u00ad\u200b-\u200f]/g, "") : s;

const clip = (s: string, n = 28) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

// ---------- 구글 문서 → 문서 · 기여 기록 (학생 · 교수 화면 공용) ----------
export type DocRow = {
  id: string;
  external_id: string;
  title: string;
  mime_type: string;
  web_url: string | null;
  last_synced_at: string | null;
};
export type SuggestionRow = {
  id: string;
  external_doc_id: string;
  added_text: string;
  removed_text: string;
  author_id: string | null;
  author_name: string | null;
  suggested_at: string | null;
  accepted_at: string;
};
export type RevisionRow = {
  id: string;
  external_doc_id: string;
  modified_at: string;
  author_id: string | null;
  google_display_name: string | null;
  chars_added: number;
  chars_removed: number;
  changes: unknown;
  credits: unknown;
};

/** 팀 하나의 연결 문서 · 제안(작성자 확인) · 직접 수정(작성자 추정)을 화면용 기록으로 */
export function buildDocumentsAndActivities(
  teamId: string,
  docRows: DocRow[],
  suggestionRows: SuggestionRow[],
  revisionRows: RevisionRow[],
  users: User[],
): { documents: ConnectedDocument[]; activities: ContributionActivity[] } {
  const documents: ConnectedDocument[] = docRows.map((d) => {
    const type = MIME_TYPE[d.mime_type] ?? "docs";
    return {
      id: d.id,
      teamId,
      name: d.title,
      type,
      // 시연용 시드 문서(demo:)는 실제 Drive 파일이 없다 — 빈 주소면 SourceLink가 "예시 문서"로 표시한다
      sourceUrl:
        d.web_url ??
        (d.external_id.startsWith(DEMO_EXTERNAL_ID_PREFIX)
          ? ""
          : `https://docs.google.com/${URL_PATH[type]}/d/${d.external_id}/edit`),
      updatedAt: d.last_synced_at,
      changeCount: 0,
    };
  });
  const docById = new Map(documents.map((d) => [d.id, d]));

  const activities: ContributionActivity[] = [];
  for (const s of suggestionRows) {
    const doc = docById.get(s.external_doc_id);
    if (!doc) continue;
    const added = s.added_text.trim();
    const removed = s.removed_text.trim();
    if (!added && !removed) continue; // 줄바꿈만 바꾼 제안
    const actionType = added && removed ? "edit" : removed ? "delete" : "add";
    activities.push({
      id: `s-${s.id}`,
      teamId,
      documentId: doc.id,
      userId: s.author_id,
      title:
        actionType === "edit"
          ? `"${clip(removed, 14)}" → "${clip(added, 14)}"`
          : actionType === "delete"
            ? `"${clip(removed)}" 삭제`
            : `"${clip(added)}" 추가`,
      actionType,
      contentBefore: removed || null,
      contentAfter: added || null,
      timestamp: s.suggested_at ?? s.accepted_at,
      // 제안은 구글이 작성자를 붙여 준다 — 팀원과 매칭되면 확정
      attributionStatus: s.author_id ? "verified" : "unknown",
      sourceUrl: doc.sourceUrl,
      authorName: cleanName(s.author_name),
      editedFrom: s.suggested_at,
      editedTo: s.suggested_at,
    });
  }
  for (const r of revisionRows) {
    const doc = docById.get(r.external_doc_id);
    if (!doc || r.chars_added + r.chars_removed === 0) continue; // 제안으로 이미 기록된 구간 등
    const fragments = (r.changes ?? []) as ChangeFragment[];
    const credits = ((r.credits ?? []) as Credit[]).sort(
      (a, b) => b.share - a.share,
    );
    const mine = credits.find((c) => c.author_id === r.author_id) ?? credits[0];
    const nameOf = (id: string | null, fallback: string | null) =>
      users.find((u) => u.id === id)?.name ??
      `${cleanName(fallback) ?? "?"} (미연결)`;
    const after = fragments
      .map((f) => f.added)
      .filter(Boolean)
      .join(" … ");
    const before = fragments
      .map((f) => f.removed)
      .filter(Boolean)
      .join(" … ");
    activities.push({
      id: `r-${r.id}`,
      teamId,
      documentId: doc.id,
      userId: r.author_id,
      title: `${doc.name} 직접 수정 (+${r.chars_added} / −${r.chars_removed}자)`,
      actionType:
        r.chars_added && r.chars_removed
          ? "edit"
          : r.chars_removed
            ? "delete"
            : "add",
      contentBefore: before || null,
      contentAfter: after || null,
      timestamp: r.modified_at,
      // 직접 수정은 마지막 수정자 · 편집 시간 비율로 정한 추정치
      attributionStatus: r.author_id ? "inferred" : "unknown",
      sourceUrl: doc.sourceUrl,
      authorName: cleanName(r.google_display_name),
      editedFrom: mine?.edited_from ?? null,
      editedTo: mine?.edited_to ?? null,
      fragments,
      shares:
        credits.length > 1
          ? credits.map((c) => ({
              userId: c.author_id,
              name: nameOf(c.author_id, c.display_name),
              share: Number(c.share),
            }))
          : undefined,
    });
  }
  for (const a of activities) {
    const doc = docById.get(a.documentId)!;
    doc.changeCount++;
    if (!doc.updatedAt || a.timestamp > doc.updatedAt)
      doc.updatedAt = a.timestamp;
  }

  return { documents, activities };
}

export type LiveLoad =
  | { status: "signed-out" }
  | { status: "no-team"; userId: string; name: string }
  | { status: "ok"; ws: Workspace };

/** 로그인 안 했으면 signed-out(→ Mock), 팀이 없으면 no-team(→ 과목 · 팀 참여 화면) */
export async function loadLiveWorkspace(
  supabase: SupabaseClient,
  preferredTeamId?: string | null,
): Promise<LiveLoad> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { status: "signed-out" };

  // 내가 속한 모든 팀 (독립 팀플 + 과목 팀플). 고른 팀이 있으면 그 팀, 없으면 최근에 들어간 팀
  const { data: memberships } = await supabase
    .from("team_members")
    .select(
      "team_id, joined_at, team:teams(id, name, invite_code, course:courses(name, kind), team_members(count))",
    )
    .eq("user_id", uid)
    .order("joined_at", { ascending: false });
  type Row = {
    id: string;
    name: string;
    invite_code: string | null;
    course: { name: string; kind: TeamTrack } | null;
    team_members: { count: number }[];
  };
  const myTeams = (memberships ?? []).map((m) => m.team as unknown as Row);
  const teams: TeamSummary[] = myTeams.map((t) => ({
    id: t.id,
    name: t.name,
    courseName: t.course?.kind === "class" ? t.course.name : "",
    track: t.course?.kind ?? "class",
    memberCount: t.team_members?.[0]?.count ?? 0,
  }));
  const membership =
    myTeams.find((t) => t.id === preferredTeamId) ?? myTeams[0];
  if (!membership) {
    const { data: me } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", uid)
      .maybeSingle();
    return {
      status: "no-team",
      userId: uid,
      name: me?.name ?? auth.user?.email ?? "",
    };
  }
  const teamRow = membership;
  const teamId = teamRow.id;
  const track: TeamTrack = teamRow.course?.kind ?? "class";

  const [
    members,
    docs,
    suggestions,
    revisions,
    meetings,
    tasks,
    files,
    events,
    scores,
  ] = await Promise.all([
    supabase
      .from("team_members")
      .select("user_id, joined_at")
      .eq("team_id", teamId)
      .order("joined_at"),
    supabase
      .from("external_docs")
      .select("id, external_id, title, mime_type, web_url, last_synced_at")
      .eq("team_id", teamId)
      .order("created_at"),
    supabase
      .from("external_doc_suggestions")
      .select(
        "id, external_doc_id, added_text, removed_text, author_id, author_name, suggested_at, accepted_at",
      )
      .eq("team_id", teamId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(300),
    supabase
      .from("external_doc_revisions")
      .select(
        "id, external_doc_id, modified_at, author_id, google_display_name, chars_added, chars_removed, changes, credits:external_doc_credits(author_id, display_name, share, edited_from, edited_to)",
      )
      .eq("team_id", teamId)
      .order("modified_at", { ascending: false })
      .limit(300),
    supabase
      .from("meetings")
      .select(
        "id, title, held_at, location, document_id, note:documents(id, content_text, version), attendance:meeting_attendance(user_id, status, comment), comments:meeting_comments(id, author_id, body, created_at)",
      )
      .eq("team_id", teamId)
      .order("held_at", { ascending: false }),
    supabase
      .from("tasks")
      .select(
        "id, title, description, due_date, status, position, assignee_id, created_by, completed_by, verified_by",
      )
      .eq("team_id", teamId)
      .order("position"),
    supabase
      .from("files")
      .select(
        "id, name, latest_version, updated_at, versions:file_versions(version, uploader_id, created_at, size_bytes, storage_path, chars_added, chars_removed, change_summary)",
      )
      .eq("team_id", teamId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("activity_events")
      .select(
        "id, user_id, category, type, points, created_at, meta, kudos(giver_id)",
      )
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("get_team_contributions", { p_team_id: teamId }),
  ]);
  for (const r of [
    members,
    docs,
    suggestions,
    revisions,
    meetings,
    tasks,
    files,
    events,
    scores,
  ]) {
    if (r.error) throw new Error(r.error.message);
  }

  // team_members는 profiles와 직접 FK가 없어서 따로 조회 (같은 과목 프로필은 RLS로 열람 가능)
  const memberIds = (members.data ?? []).map((m) => m.user_id as string);
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, email")
    .in("id", memberIds);
  if (profileError) throw new Error(profileError.message);
  const users: User[] = memberIds.map((id) => {
    const p = profiles?.find((x) => x.id === id);
    return {
      id,
      name: cleanName(p?.name ?? null) ?? "팀원",
      email: p?.email ?? "",
    };
  });
  const me = users.find((u) => u.id === uid) ?? {
    id: uid,
    name: auth.user?.email ?? "나",
    email: auth.user?.email ?? "",
  };

  const { documents, activities } = buildDocumentsAndActivities(
    teamId,
    (docs.data ?? []) as DocRow[],
    (suggestions.data ?? []) as SuggestionRow[],
    (revisions.data ?? []) as RevisionRow[],
    users,
  );

  const meetingList: Meeting[] = (meetings.data ?? []).map((m) => {
    const note = m.note as unknown as {
      id: string;
      content_text: string;
      version: number;
    } | null;
    const rows = (m.attendance ?? []) as {
      user_id: string;
      status: AttendanceStatus;
      comment: string | null;
    }[];
    const comments = (m.comments ?? []) as {
      id: string;
      author_id: string;
      body: string;
      created_at: string;
    }[];
    return {
      id: m.id,
      teamId,
      title: m.title,
      heldAt: m.held_at,
      location: m.location ?? "",
      notes: note?.content_text ?? "",
      attendance: Object.fromEntries(
        users.map((u) => [
          u.id,
          rows.find((r) => r.user_id === u.id)?.status ?? "unchecked",
        ]),
      ),
      noteDocumentId: note?.id ?? m.document_id,
      noteVersion: note?.version,
      attendanceComments: Object.fromEntries(
        rows.map((r) => [r.user_id, r.comment]),
      ),
      comments: comments
        .map((c) => ({
          id: c.id,
          authorId: c.author_id,
          body: c.body,
          createdAt: c.created_at,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  });

  const ws: Workspace = {
    mode: "live",
    me,
    team: {
      id: teamId,
      name: teamRow.name,
      courseName: track === "class" ? (teamRow.course?.name ?? "") : "",
      members: users.map((u, i) => ({
        userId: u.id,
        role: i === 0 ? "leader" : "member",
      })),
      track,
      inviteCode: teamRow.invite_code,
    },
    teams,
    users,
    documents,
    activities: activities.sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    ),
    meetings: meetingList,
    tasks: (tasks.data ?? []).map((t): Task => ({
      description: t.description,
      dueDate: t.due_date,
      id: t.id,
      title: t.title,
      status: t.status,
      position: t.position,
      assigneeId: t.assignee_id,
      createdBy: t.created_by,
      completedBy: t.completed_by,
      verifiedBy: t.verified_by,
    })),
    files: (files.data ?? []).map((f): TeamFile => {
      const versions = (f.versions ?? []) as {
        version: number;
        uploader_id: string;
        created_at: string;
        size_bytes: number | null;
        storage_path: string;
        chars_added: number;
        chars_removed: number;
        change_summary: TeamFile["versions"][number]["summary"];
      }[];
      return {
        id: f.id,
        name: f.name,
        latestVersion: f.latest_version,
        updatedAt: f.updated_at,
        versions: versions
          .map((v) => ({
            version: v.version,
            uploaderId: v.uploader_id,
            createdAt: v.created_at,
            sizeBytes: v.size_bytes,
            storagePath: v.storage_path,
            charsAdded: v.chars_added,
            charsRemoved: v.chars_removed,
            summary: v.change_summary ?? {},
          }))
          .sort((a, b) => b.version - a.version),
      };
    }),
    events: (events.data ?? []).map((e): ActivityEvent => ({
      id: e.id,
      userId: e.user_id,
      category: e.category,
      type: e.type,
      points: Number(e.points),
      createdAt: e.created_at,
      meta: (e.meta ?? {}) as Record<string, unknown>,
      kudosFrom: ((e.kudos ?? []) as { giver_id: string }[]).map(
        (k) => k.giver_id,
      ),
    })),
    scores: ((scores.data ?? []) as ContributionScore[]).map((c) => ({
      ...c,
      document_score: Number(c.document_score),
      task_score: Number(c.task_score),
      meeting_score: Number(c.meeting_score),
      file_score: Number(c.file_score),
      share_pct: Number(c.share_pct),
      peer_share_pct:
        c.peer_share_pct === null ? null : Number(c.peer_share_pct),
    })),
  };
  return { status: "ok", ws };
}

// ---------- 쓰기 (RLS · 트리거가 팀원 여부와 본인 출석 금지를 다시 검사) ----------
export async function createLiveMeeting(
  supabase: SupabaseClient,
  teamId: string,
  input: { title: string; heldAt: string; location: string },
) {
  const { data, error } = await supabase
    .from("meetings")
    .insert({
      team_id: teamId,
      title: input.title,
      held_at: input.heldAt,
      location: input.location || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`회의를 만들지 못했습니다 (${error.message})`);
  return data.id as string;
}

export async function setLiveAttendance(
  supabase: SupabaseClient,
  meetingId: string,
  userId: string,
  status: AttendanceStatus,
) {
  const { error } = await supabase
    .from("meeting_attendance")
    .update({ status })
    .eq("meeting_id", meetingId)
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      error.message.includes("본인")
        ? "본인의 출석은 다른 팀원이 확인해야 합니다."
        : error.message,
    );
  }
}

/** 회의록 저장: 등잔 문서 저장 API (작성자 · 글자 수 diff · 기여 기록까지 서버가 처리) */
export async function saveLiveNotes(meeting: Meeting, notes: string) {
  if (!meeting.noteDocumentId || !meeting.noteVersion)
    throw new Error("회의록 문서를 찾을 수 없습니다.");
  const content = {
    type: "doc",
    content: notes.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
  const res = await fetch(`/api/documents/${meeting.noteDocumentId}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseVersion: meeting.noteVersion,
      content,
      contentText: notes,
    }),
  });
  if (res.status === 409)
    throw new Error(
      "다른 팀원이 먼저 저장했어요. 새로고침 후 다시 저장해 주세요.",
    );
  if (!res.ok) throw new Error("회의록을 저장하지 못했습니다.");
}

// ---------- 보드 (태스크) ----------
export async function createTask(
  supabase: SupabaseClient,
  teamId: string,
  title: string,
  position: number,
) {
  const { error } = await supabase
    .from("tasks")
    .insert({ team_id: teamId, title, position });
  if (error) throw new Error(`태스크를 만들지 못했습니다 (${error.message})`);
}

/** 상태 · 담당자 · 확인. 완료자 · 확인 규칙은 DB 트리거가 강제 (본인 완료를 본인이 확인 불가 등) */
export async function updateTask(
  supabase: SupabaseClient,
  taskId: string,
  patch: Partial<{
    status: TaskStatus;
    assignee_id: string | null;
    verified_by: string | null;
    title: string;
    description: string | null;
    due_date: string | null;
    position: number;
  }>,
) {
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);
}

export async function deleteTask(supabase: SupabaseClient, taskId: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
}

export async function moveTask(supabase: SupabaseClient, taskId: string, status: TaskStatus, beforeId: string | null) {
  const { error } = await supabase.rpc("move_task", { p_task: taskId, p_status: status, p_before: beforeId });
  if (error) throw new Error(error.message);
}

// ---------- 파일 ----------
/** Storage(team-files/{teamId}/...)에 올린 뒤 서버가 텍스트 추출 · 이전 버전과 비교 · 버전 등록 */
export async function uploadTeamFile(
  supabase: SupabaseClient,
  teamId: string,
  file: File,
) {
  // Storage 키는 ASCII만 허용 → 경로는 uuid + 확장자, 원래 이름(한글 등)은 등록 API로 전달
  const ext = (file.name.split(".").pop() ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 10);
  const storagePath = `${teamId}/${crypto.randomUUID()}${ext && file.name.includes(".") ? `.${ext}` : ""}`;
  const { error } = await supabase.storage
    .from("team-files")
    .upload(storagePath, file, { upsert: false });
  if (error) throw new Error(`업로드하지 못했습니다 (${error.message})`);
  const res = await fetch("/api/files/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId, fileName: file.name, storagePath }),
  });
  if (!res.ok) throw new Error("파일 버전을 등록하지 못했습니다.");
}

export async function fileDownloadUrl(
  supabase: SupabaseClient,
  storagePath: string,
) {
  const { data, error } = await supabase.storage
    .from("team-files")
    .createSignedUrl(storagePath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------- 👍 · 회의 코멘트 · 출결 코멘트 ----------
export async function toggleKudos(
  supabase: SupabaseClient,
  teamId: string,
  eventId: string,
  me: string,
  given: boolean,
) {
  const { error } = given
    ? await supabase
        .from("kudos")
        .delete()
        .eq("event_id", eventId)
        .eq("giver_id", me)
    : await supabase
        .from("kudos")
        .insert({ event_id: eventId, team_id: teamId });
  if (error)
    throw new Error(
      error.message.includes("본인")
        ? "본인 활동에는 👍를 줄 수 없어요."
        : error.message,
    );
}

export async function addMeetingComment(
  supabase: SupabaseClient,
  teamId: string,
  meetingId: string,
  body: string,
) {
  const { error } = await supabase
    .from("meeting_comments")
    .insert({ meeting_id: meetingId, team_id: teamId, body });
  if (error) throw new Error(error.message);
}

export async function setAttendanceComment(
  supabase: SupabaseClient,
  meetingId: string,
  userId: string,
  comment: string,
) {
  const { error } = await supabase
    .from("meeting_attendance")
    .update({ comment: comment.trim() || null })
    .eq("meeting_id", meetingId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ---------- 구글 드라이브에서 문서 골라 연결 ----------
/** 구글 미연결이면 연결 화면으로 보냄 (돌아오면 다시 누르면 됨) */

// ---------- 과목 · 팀 참여 (팀이 없을 때) ----------
export async function loadJoinableCourses(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("course_members")
    .select("course:courses(id, name, semester, kind, teams(id, name))")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map(
      (r) =>
        r.course as unknown as {
          id: string;
          name: string;
          semester: string;
          kind: TeamTrack;
          teams: { id: string; name: string }[];
        },
    )
    .filter((c) => c.kind === "class");
}

// ---------- 1트랙: 독립 팀플 (교수 없음) ----------
export async function createIndependentTeam(
  supabase: SupabaseClient,
  name: string,
) {
  const { data, error } = await supabase.rpc("create_independent_team", {
    p_name: name,
  });
  if (error) throw new Error(error.message);
  return data as { team_id: string; invite_code: string };
}

export async function joinTeamByCode(supabase: SupabaseClient, code: string) {
  const { data, error } = await supabase.rpc("join_team_by_code", {
    p_code: code,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** /lamp 첫 화면(모든 프로젝트) 대시보드용 — 내가 속한 팀들의 요약 숫자만 가볍게 읽는다 */
export interface TeamOverview {
  teamId: string;
  taskTotal: number;
  taskDone: number;
  myOpen: { id: string; title: string; status: TaskStatus }[];
  nextMeeting: { title: string; heldAt: string } | null;
  docCount: number;
  weekActivity: number;
  lastActivityAt: string | null;
}
export async function loadTeamsOverview(
  supabase: SupabaseClient,
  teamIds: string[],
  userId: string,
): Promise<TeamOverview[]> {
  if (!teamIds.length) return [];
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const soon = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const [tasks, meetings, docs, revisions] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, team_id, title, status, assignee_id, position")
      .in("team_id", teamIds)
      .order("position"),
    supabase
      .from("meetings")
      .select("team_id, title, held_at")
      .in("team_id", teamIds)
      .gte("held_at", soon)
      .order("held_at"),
    supabase.from("external_docs").select("id, team_id").in("team_id", teamIds),
    supabase
      .from("external_doc_revisions")
      .select("team_id, modified_at")
      .in("team_id", teamIds)
      .order("modified_at", { ascending: false })
      .limit(1000),
  ]);
  return teamIds.map((teamId) => {
    const t = (tasks.data ?? []).filter((r) => r.team_id === teamId);
    const m = (meetings.data ?? []).find((r) => r.team_id === teamId);
    const rev = (revisions.data ?? []).filter((r) => r.team_id === teamId);
    return {
      teamId,
      taskTotal: t.length,
      taskDone: t.filter((r) => r.status === "done").length,
      myOpen: t
        .filter((r) => r.assignee_id === userId && r.status !== "done")
        .map((r) => ({
          id: r.id as string,
          title: r.title as string,
          status: r.status as TaskStatus,
        })),
      nextMeeting: m
        ? { title: m.title as string, heldAt: m.held_at as string }
        : null,
      docCount: (docs.data ?? []).filter((r) => r.team_id === teamId).length,
      weekActivity: rev.filter((r) => (r.modified_at as string) >= since)
        .length,
      lastActivityAt: (rev[0]?.modified_at as string | undefined) ?? null,
    };
  });
}
