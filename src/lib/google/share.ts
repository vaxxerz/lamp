// 서버 전용: 램프 팀 멤버십을 기준으로 연결된 구글 문서의 공유 권한을 맞춘다.
//  - 권한 변경은 문서를 연결한 사람(linked_by)의 토큰으로 수행 (drive.file: 앱이 연 파일만 가능)
//  - 현재 권한 목록을 먼저 읽고 빠진 팀원만 추가 → 동기화 때마다 호출해도 불필요한 요청이 없음
//  - 실패(공유 권한 없음 · 토큰 만료 · 도메인 정책)는 모아서 반환하고 호출 흐름은 막지 않는다
import type { SupabaseClient } from "@supabase/supabase-js";
import { deletePermission, GoogleApiError, grantWriter, listPermissions } from "./drive";
import { getUserAccessToken } from "./oauth";
import { DEMO_EXTERNAL_ID_PATTERN } from "./demo";

export type ShareReason =
  | "no_share_permission" // 연결한 사람이 소유자/공유 가능한 편집자가 아님
  | "domain_policy" // 학교(워크스페이스) 정책상 외부 공유 차단
  | "invalid_recipient" // 구글 계정이 아닌 이메일
  | "linker_not_connected" // 연결한 사람의 구글 연결이 끊김
  | "no_email" // 팀원 이메일을 알 수 없음
  | "file_not_found"
  | "error";

export type ShareFailure = {
  externalDocId: string;
  title: string;
  memberName: string | null; // null = 문서 전체 문제 (연결자 토큰 없음 등)
  reason: ShareReason;
};
export type ShareResult = { granted: number; revoked: number; failed: ShareFailure[] };

type DocRow = { id: string; title: string; external_id: string; linked_by: string };
type Member = { userId: string; name: string; email: string | null };

const empty = (): ShareResult => ({ granted: 0, revoked: 0, failed: [] });

async function loadMembers(admin: SupabaseClient, userIds: string[]): Promise<Member[]> {
  if (userIds.length === 0) return [];
  const [{ data: accounts }, { data: profiles }] = await Promise.all([
    admin.from("google_accounts").select("user_id, google_email").in("user_id", userIds),
    admin.from("profiles").select("id, name, email").in("id", userIds),
  ]);
  const google = new Map((accounts ?? []).map((a) => [a.user_id as string, a.google_email as string]));
  const profile = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  return userIds.map((id) => ({
    userId: id,
    name: (profile.get(id)?.name as string | undefined) ?? "팀원",
    // 실제 구글 계정 이메일 우선 (로그인 이메일과 다를 수 있음)
    email: google.get(id) ?? (profile.get(id)?.email as string | undefined) ?? null,
  }));
}

async function teamMemberIds(admin: SupabaseClient, teamId: string): Promise<string[]> {
  const { data } = await admin.from("team_members").select("user_id").eq("team_id", teamId);
  return (data ?? []).map((m) => m.user_id as string);
}

async function teamDocs(admin: SupabaseClient, teamId: string, docIds?: string[]): Promise<DocRow[]> {
  let q = admin.from("external_docs").select("id, title, external_id, linked_by")
    .eq("team_id", teamId)
    .not("external_id", "like", DEMO_EXTERNAL_ID_PATTERN);
  if (docIds) q = q.in("id", docIds);
  const { data } = await q;
  return (data ?? []) as DocRow[];
}

export function reasonOf(e: unknown): ShareReason {
  if (!(e instanceof GoogleApiError)) return "error";
  const msg = e.message;
  if (/publishOutNotPermitted|domainPolicy|cannotShare.*Domain/i.test(msg)) return "domain_policy";
  if (e.status === 403) return "no_share_permission";
  if (e.status === 404) return "file_not_found";
  if (e.status === 400) return "invalid_recipient";
  return "error";
}

/**
 * 팀 문서마다 빠진 팀원에게 편집 권한을 준다.
 *  userIds: 대상 팀원 (기본값: 현재 팀원 전원) / docIds: 대상 문서 (기본값: 팀의 모든 연결 문서)
 */
export async function ensureTeamAccess(
  admin: SupabaseClient,
  teamId: string,
  opts: { userIds?: string[]; docIds?: string[] } = {},
): Promise<ShareResult> {
  const result = empty();
  const [docs, members] = await Promise.all([
    teamDocs(admin, teamId, opts.docIds),
    opts.userIds ? loadMembers(admin, opts.userIds) : teamMemberIds(admin, teamId).then((ids) => loadMembers(admin, ids)),
  ]);

  for (const doc of docs) {
    const targets = members.filter((m) => m.userId !== doc.linked_by); // 연결한 사람은 이미 접근 가능
    if (targets.length === 0) continue;
    const token = await getUserAccessToken(admin, doc.linked_by).catch(() => null);
    if (!token) {
      result.failed.push({ externalDocId: doc.id, title: doc.title, memberName: null, reason: "linker_not_connected" });
      continue;
    }

    let existing: Set<string>;
    try {
      const perms = await listPermissions(token, doc.external_id);
      existing = new Set(perms.map((p) => p.emailAddress?.toLowerCase()).filter((x): x is string => !!x));
    } catch (e) {
      result.failed.push({ externalDocId: doc.id, title: doc.title, memberName: null, reason: reasonOf(e) });
      continue;
    }

    for (const m of targets) {
      if (!m.email) {
        result.failed.push({ externalDocId: doc.id, title: doc.title, memberName: m.name, reason: "no_email" });
        continue;
      }
      if (existing.has(m.email.toLowerCase())) continue;
      try {
        await grantWriter(token, doc.external_id, m.email);
        result.granted++;
      } catch (e) {
        result.failed.push({ externalDocId: doc.id, title: doc.title, memberName: m.name, reason: reasonOf(e) });
      }
    }
  }
  return result;
}

/** userId 의 접근 권한을 팀의 연결 문서에서 회수 (소유자 권한 · 본인이 연결한 문서는 유지) */
export async function revokeMemberAccess(admin: SupabaseClient, teamId: string, userId: string): Promise<ShareResult> {
  const result = empty();
  const [docs, [member]] = await Promise.all([teamDocs(admin, teamId), loadMembers(admin, [userId])]);
  if (!member?.email) return result;
  const email = member.email.toLowerCase();

  for (const doc of docs) {
    if (doc.linked_by === userId) continue;
    const token = await getUserAccessToken(admin, doc.linked_by).catch(() => null);
    if (!token) {
      result.failed.push({ externalDocId: doc.id, title: doc.title, memberName: member.name, reason: "linker_not_connected" });
      continue;
    }
    try {
      const perms = await listPermissions(token, doc.external_id);
      for (const p of perms) {
        if (p.type === "user" && p.role !== "owner" && p.emailAddress?.toLowerCase() === email) {
          await deletePermission(token, doc.external_id, p.id);
          result.revoked++;
        }
      }
    } catch (e) {
      result.failed.push({ externalDocId: doc.id, title: doc.title, memberName: member.name, reason: reasonOf(e) });
    }
  }
  return result;
}
