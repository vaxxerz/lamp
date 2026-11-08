// 서버 전용 — 로그인 사용자 권한(RLS)으로 팀 기록을 모아 AnalysisInput을 만든다.
//  RLS(can_view_team)가 팀원 · 담당 교수만 읽게 막으므로 팀 행이 안 보이면 권한 없음.
import type { SupabaseClient } from "@supabase/supabase-js";
import { periodFromMs, periodRange } from "./rules";
import type { AnalysisEvent, AnalysisInput, AnalysisPeriodKey, EventCategory } from "./types";

const clip = (s: string | null | undefined, n = 300) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : undefined;
};
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const STATUS_LABEL: Record<string, string> = { present: "출석", late: "지각" };

type EventRow = {
  id: string;
  user_id: string;
  category: EventCategory;
  type: string;
  points: number | string;
  ref_table: string;
  ref_id: string;
  created_at: string;
  meta: Record<string, unknown> | null;
};

export class NotVisibleError extends Error {}

export async function collectAnalysisInput(
  supabase: SupabaseClient,
  teamId: string,
  period: AnalysisPeriodKey,
  now = Date.now(),
): Promise<AnalysisInput> {
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select(
      "id, name, course:courses(name, kind, weight_document, weight_task, weight_meeting, weight_file)",
    )
    .eq("id", teamId)
    .maybeSingle();
  if (teamError) throw new Error(teamError.message);
  if (!team) throw new NotVisibleError("team_not_visible");
  const course = team.course as unknown as {
    name: string;
    kind: "class" | "independent";
    weight_document: number;
    weight_task: number;
    weight_meeting: number;
    weight_file: number;
  } | null;

  const fromMs = periodFromMs(period, now);
  const since = fromMs === null ? null : new Date(fromMs).toISOString();
  let eventsQuery = supabase
    .from("activity_events")
    .select("id, user_id, category, type, points, ref_table, ref_id, created_at, meta")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (since) eventsQuery = eventsQuery.gte("created_at", since);
  let meetingsQuery = supabase
    .from("meetings")
    .select("id, title, held_at, attendance:meeting_attendance(user_id, status, comment)")
    .eq("team_id", teamId)
    .order("held_at");
  if (since) meetingsQuery = meetingsQuery.gte("held_at", since);

  const [members, events, meetings, tasks, scores] = await Promise.all([
    supabase.from("team_members").select("user_id, joined_at").eq("team_id", teamId).order("joined_at"),
    eventsQuery,
    meetingsQuery,
    supabase.from("tasks").select("title, status, assignee_id, completed_by").eq("team_id", teamId).order("position"),
    supabase.rpc("get_team_contributions", { p_team_id: teamId }),
  ]);
  for (const r of [members, events, meetings, tasks]) if (r.error) throw new Error(r.error.message);

  const memberIds = (members.data ?? []).map((m) => m.user_id as string);
  const { data: profiles, error: profileError } = await supabase.from("profiles").select("id, name").in("id", memberIds);
  if (profileError) throw new Error(profileError.message);

  const rows = (events.data ?? []) as EventRow[];
  // 내용 근거: 구글 제안 원문 · 직접 수정 조각
  const suggestionIds = rows.filter((r) => r.ref_table === "external_doc_suggestions").map((r) => r.ref_id);
  const revisionIds = [
    ...new Set(
      rows
        .filter((r) => r.ref_table === "external_doc_credits")
        .map((r) => (r.meta?.revision_id as string | undefined) ?? "")
        .filter(Boolean),
    ),
  ];
  const [suggestions, revisions] = await Promise.all([
    suggestionIds.length
      ? supabase.from("external_doc_suggestions").select("id, added_text, removed_text").in("id", suggestionIds.slice(0, 500))
      : Promise.resolve({ data: [], error: null }),
    revisionIds.length
      ? supabase.from("external_doc_revisions").select("id, changes").in("id", revisionIds.slice(0, 500))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const suggestionText = new Map(
    ((suggestions.data ?? []) as { id: string; added_text: string | null; removed_text: string | null }[]).map((s) => [
      s.id,
      [s.added_text && `+ ${s.added_text}`, s.removed_text && `− ${s.removed_text}`].filter(Boolean).join(" / "),
    ]),
  );
  const revisionText = new Map(
    ((revisions.data ?? []) as { id: string; changes: { added?: string; removed?: string; after?: string }[] | null }[]).map(
      (r) => [
        r.id,
        (r.changes ?? [])
          .map((c) => c.added ?? c.after ?? "")
          .filter(Boolean)
          .join(" / "),
      ],
    ),
  );

  const analysisEvents: AnalysisEvent[] = rows
    .filter((r) => memberIds.includes(r.user_id))
    .map((r) => {
      const m = r.meta ?? {};
      const added = num(m.chars_added);
      const removed = num(m.chars_removed);
      const size = added || removed ? ` (+${added} / −${removed}자)` : "";
      const title = (m.title as string) ?? (m.document_title as string) ?? (m.file_name as string) ?? "";
      const inferred = r.ref_table === "external_doc_credits";
      let label: string;
      let excerpt: string | undefined;
      switch (r.type) {
        case "external_doc_edit":
          label = `${title || "구글 문서"} ${m.source === "suggestion" ? "제안 수락" : "직접 수정"}${size}`;
          excerpt = clip(
            r.ref_table === "external_doc_suggestions"
              ? suggestionText.get(r.ref_id)
              : revisionText.get((m.revision_id as string) ?? ""),
          );
          break;
        case "doc_edit":
          label = `${title || "문서"} 저장${size}`;
          break;
        case "meeting_note":
          label = `${title || "회의"} 회의록 작성`;
          break;
        case "meeting_attend":
          label = `${title || "회의"} ${STATUS_LABEL[m.status as string] ?? "참석"}`;
          break;
        case "task_create":
          label = `할 일 만들기 · ${title}`;
          break;
        case "task_complete":
          label = `할 일 완료 · ${title}${m.verified ? " (팀원 확인)" : ""}`;
          break;
        case "file_version":
          label = `${title || "파일"} v${num(m.version)} 업로드${size}`;
          {
            const changed = (m.slides_changed as number[] | undefined)?.length;
            const addedSlides = (m.slides_added as number[] | undefined)?.length;
            if (changed || addedSlides)
              excerpt = `슬라이드 수정 ${changed ?? 0}장 · 추가 ${addedSlides ?? 0}장`;
          }
          break;
        default:
          label = title || r.type;
      }
      return {
        id: r.id,
        userId: r.user_id,
        category: r.category,
        type: r.type,
        points: num(r.points),
        createdAt: r.created_at,
        attribution: inferred ? "inferred" : "verified",
        label,
        excerpt,
        added,
        removed,
      };
    });

  const track = course?.kind ?? "class";
  return {
    version: 1,
    team: {
      id: team.id,
      name: team.name,
      track,
      ...(track === "class" && course
        ? {
            course: {
              name: course.name,
              weights: {
                document: num(course.weight_document),
                task: num(course.weight_task),
                meeting: num(course.weight_meeting),
                file: num(course.weight_file),
              },
            },
          }
        : {}),
    },
    period: periodRange(period, now, analysisEvents[0]?.createdAt ?? null),
    members: memberIds.map((id, i) => ({
      id,
      name: (profiles ?? []).find((p) => p.id === id)?.name?.trim() || "팀원",
      role: i === 0 ? "leader" : "member",
    })),
    events: analysisEvents,
    scores: scores.error
      ? undefined
      : ((scores.data ?? []) as { user_id: string; share_pct: number; peer_share_pct: number | null; mismatch: boolean; kudos_received: number }[]).map(
          (s) => ({
            userId: s.user_id,
            sharePct: num(s.share_pct),
            peerSharePct: s.peer_share_pct === null ? null : num(s.peer_share_pct),
            mismatch: !!s.mismatch,
            kudos: num(s.kudos_received),
          }),
        ),
    meetings: ((meetings.data ?? []) as {
      id: string;
      title: string;
      held_at: string;
      attendance: { user_id: string; status: string }[];
    }[]).map((m) => ({
      id: m.id,
      title: m.title,
      heldAt: m.held_at,
      attendance: Object.fromEntries((m.attendance ?? []).map((a) => [a.user_id, a.status])),
    })),
    tasks: ((tasks.data ?? []) as { title: string; status: string; assignee_id: string | null; completed_by: string | null }[]).map(
      (t) => ({ title: t.title, status: t.status, assigneeId: t.assignee_id, completedBy: t.completed_by }),
    ),
  };
}
