// 서버 전용: 드라이브 파일을 팀에 연결 → 첫 동기화 → 현재 팀원 전원에게 공유 (link · create 라우트 공용)
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveFile } from "./drive";
import { ensureTeamAccess, type ShareResult } from "./share";
import { EXTERNAL_DOC_COLUMNS, syncExternalDoc, type ExternalDocRow, type SyncResult } from "./sync";

export type LinkResult =
  | { ok: true; externalDocId: string; title: string; webUrl: string | null; sync: SyncResult; share: ShareResult }
  | { ok: false; error: string; status: number };

export async function linkDocToTeam(
  admin: SupabaseClient,
  teamId: string,
  userId: string,
  file: DriveFile,
): Promise<LinkResult> {
  const { data: id, error } = await admin.rpc("link_external_doc", {
    p_team_id: teamId,
    p_user_id: userId,
    p_external_id: file.id,
    p_title: file.name,
    p_mime_type: file.mimeType,
    p_web_url: file.webViewLink ?? null,
  });
  if (error) return { ok: false, error: error.message, status: error.message === "not_team_member" ? 403 : 500 };

  const { data: doc } = await admin.from("external_docs").select(EXTERNAL_DOC_COLUMNS).eq("id", id).single();
  const sync = await syncExternalDoc(admin, doc as ExternalDocRow);
  // 공유 실패는 연결 실패가 아님 → 결과만 돌려주고 화면에서 안내
  const share = await ensureTeamAccess(admin, teamId, { docIds: [id as string] }).catch(
    (): ShareResult => ({ granted: 0, revoked: 0, failed: [] }),
  );
  return { ok: true, externalDocId: id as string, title: file.name, webUrl: file.webViewLink ?? null, sync, share };
}
