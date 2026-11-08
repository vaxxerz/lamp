// 서버 전용: 구글 문서 제안을 작성자와 함께 기록하고 바로 수락 (워커가 2초마다 호출)
//
//  ① Docs API로 지금 있는 제안 목록 (작성자 없음)
//  ② 처음 본 제안 · 내용이 바뀐 제안 → pending, stable_since 갱신 (아직 입력 중)
//  ③ 내용이 STABLE_MS 동안 그대로인 제안만 처리 대상
//  ④ docx로 내보내 변경 내용 추적에서 작성자 · 시각 찾기 → record_external_suggestion
//  ⑤ 작성자를 찾은 제안만 acceptSuggestion (docx에 아직 없는 제안은 다음 차례로)
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acceptSuggestions,
  exportDocxDocumentXml,
  getDocumentWithSuggestions,
  GOOGLE_MIME,
  GoogleApiError,
} from "./drive";
import { forgetCachedToken, getUserAccessToken } from "./oauth";
import { extractSuggestions, matchAuthors, parseTrackedChanges, suggestionHash, type DocSuggestion } from "./suggestions";
import type { ExternalDocRow } from "./sync";

/**
 * 제안 내용이 이만큼 그대로면 입력이 끝난 것으로 봄.
 * 짧을수록 빨리 수락되지만, 입력 도중에 수락되면 나머지 글자는 다음 제안으로 이어서 기록된다 (작성자는 같음).
 */
export const STABLE_MS = Number(process.env.SUGGESTION_STABLE_MS ?? 1_000);

export type SuggestionTickResult = {
  externalDocId: string;
  seen: number;
  accepted: number;
  waiting: number;
  error?: "linker_not_connected" | "file_access_lost" | "google_error";
};

type Row = { id: string; suggestion_id: string; status: string; text_hash: string; stable_since: string };

const visible = (s: string) => s.replace(/\s/g, "").length;

export async function processSuggestions(admin: SupabaseClient, doc: ExternalDocRow): Promise<SuggestionTickResult> {
  const base = { externalDocId: doc.id, seen: 0, accepted: 0, waiting: 0 };
  if (doc.mime_type !== GOOGLE_MIME.document) return base;

  try {
    const token = await getUserAccessToken(admin, doc.linked_by);
    if (!token) return { ...base, error: "linker_not_connected" };

    const suggestions = extractSuggestions(await getDocumentWithSuggestions(token, doc.external_id));
    const { data: rows, error } = await admin
      .from("external_doc_suggestions")
      .select("id, suggestion_id, status, text_hash, stable_since")
      .eq("external_doc_id", doc.id)
      .in("status", ["pending", "accepted"]);
    if (error) throw error;
    const known = new Map((rows as Row[]).map((r) => [r.suggestion_id, r]));
    const present = new Set(suggestions.map((s) => s.id));
    const now = Date.now();

    // 사라진 pending (누가 직접 수락 · 거절) → gone
    const gone = (rows as Row[]).filter((r) => r.status === "pending" && !present.has(r.suggestion_id)).map((r) => r.id);
    if (gone.length) await admin.from("external_doc_suggestions").update({ status: "gone" }).in("id", gone);

    const ready: DocSuggestion[] = [];
    const retryAccept: string[] = []; // 기록은 됐는데 수락이 실패했던 제안
    for (const s of suggestions) {
      const row = known.get(s.id);
      const hash = suggestionHash(s);
      if (!row) {
        const { error: insertError } = await admin.from("external_doc_suggestions").upsert(
          {
            external_doc_id: doc.id,
            team_id: doc.team_id,
            suggestion_id: s.id,
            added_text: s.added,
            removed_text: s.removed,
            text_hash: hash,
          },
          { onConflict: "external_doc_id,suggestion_id", ignoreDuplicates: true },
        );
        if (insertError) throw insertError;
      } else if (row.status === "accepted") {
        retryAccept.push(s.id);
      } else if (row.text_hash !== hash) {
        const { error: updateError } = await admin
          .from("external_doc_suggestions")
          .update({ text_hash: hash, added_text: s.added, removed_text: s.removed, stable_since: new Date(now).toISOString() })
          .eq("id", row.id);
        if (updateError) throw updateError;
      } else if (now - Date.parse(row.stable_since) >= STABLE_MS) {
        ready.push(s);
      }
    }

    let recorded: string[] = [];
    if (ready.length > 0) {
      const changes = parseTrackedChanges(await exportDocxDocumentXml(token, doc.external_id));
      const matched = matchAuthors(ready, changes);
      for (const m of matched) {
        const { error: rpcError } = await admin.rpc("record_external_suggestion", {
          p_external_doc_id: doc.id,
          p_suggestion_id: m.id,
          p_added_text: m.added,
          p_removed_text: m.removed,
          p_chars_added: visible(m.added),
          p_chars_removed: visible(m.removed),
          p_author_name: m.author || null,
          p_suggested_at: m.date,
        });
        if (rpcError) throw rpcError;
      }
      recorded = matched.map((m) => m.id);
    }

    const accepted = await acceptSuggestions(token, doc.external_id, [...recorded, ...retryAccept]);
    return {
      ...base,
      seen: suggestions.length,
      accepted: accepted.length,
      waiting: suggestions.length - accepted.length,
    };
  } catch (e) {
    // 캐시된 토큰이 취소됨(연결 해제 후 재연결 등) → 버리고 다음 호출에서 새로 발급
    if (e instanceof GoogleApiError && e.status === 401) forgetCachedToken(doc.linked_by);
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return { ...base, error: "file_access_lost" };
    }
    console.error("google suggestion tick failed", doc.id, e);
    return { ...base, error: "google_error" };
  }
}
