// 서버 전용: 연결된 구글 문서의 수정 구간을 수집해 편집자별 기여로 기록
//
//  ① 자체 스냅샷 — 문서가 바뀌었으면 현재 본문을 export해 직전 스냅샷과 diff (연결 이후 구간)
//  ② revision 소급 — 첫 스냅샷(snapshot_since) 이전 revision만 (연결 이전 구간, 중복 집계 방지)
//  ③ Drive Activity API — 각 구간에 실제로 편집한 사람과 편집 시간 → attribute()로 diff 배분
//  ④ 재배분 — Activity는 늦게 반영될 수 있어서, 최근 스냅샷 구간은 SETTLE_MS 동안 다시 배분
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffWithFragments, type ChangeFragment } from "@/lib/diff";
import { attribute } from "./attribute";
import {
  exportCurrentText,
  exportRevisionText,
  GoogleApiError,
  getFileState,
  listRevisions,
  queryEditActivity,
  type EditSpan,
} from "./drive";
import { forgetCachedToken, getUserAccessToken } from "./oauth";

/** 한 번 호출에 처리할 revision 수 (서버리스 시간 제한 대비). 남으면 remaining > 0 */
export const SYNC_BATCH = 25;
/** Activity 반영 지연 여유: 조회 구간을 이만큼 앞당김 */
const ACTIVITY_LAG_MS = 3 * 60_000;
/** 스냅샷 구간 배분을 확정하기까지 기다리는 시간 */
const SETTLE_MS = 5 * 60_000;

export type ExternalDocRow = {
  id: string;
  team_id: string;
  external_id: string;
  mime_type: string;
  linked_by: string;
  last_synced_at: string | null;
};

export type SyncResult = {
  externalDocId: string;
  processed: number;
  remaining: number;
  snapshot?: "baseline" | "recorded" | "unchanged";
  /** unavailable: Activity 스코프 미허용 등 → lastModifyingUser로 대체 */
  activity?: "ok" | "unavailable";
  error?: "linker_not_connected" | "file_access_lost" | "google_error";
};

export const EXTERNAL_DOC_COLUMNS = "id, team_id, external_id, mime_type, linked_by, last_synced_at";

type PendingSegment = {
  id: string;
  period_start: string | null;
  modified_at: string;
  chars_added: number;
  chars_removed: number;
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

export async function syncExternalDoc(
  admin: SupabaseClient,
  doc: ExternalDocRow,
  { refreshSnapshot = false }: { readonly refreshSnapshot?: boolean } = {},
): Promise<SyncResult> {
  const base = { externalDocId: doc.id, processed: 0, remaining: 0 };
  let processed = 0;

  try {
    // drive.file 스코프라 "문서를 연결한 사람"의 토큰으로만 접근 가능
    const token = await getUserAccessToken(admin, doc.linked_by);
    if (!token) return { ...base, error: "linker_not_connected" };

    const [{ data: state, error: stateError }, { data: pendingRows, error: pendingError }] = await Promise.all([
      admin
        .from("external_docs")
        .select(
          "last_revision_id, last_text, snapshot_text, snapshot_at, snapshot_modified_at, snapshot_since, external_doc_revisions(external_revision_id, text_available)",
        )
        .eq("id", doc.id)
        .single(),
      admin
        .from("external_doc_revisions")
        .select("id, period_start, modified_at, chars_added, chars_removed")
        .eq("external_doc_id", doc.id)
        .eq("source", "snapshot")
        .eq("attribution_final", false)
        .order("modified_at")
        .limit(50),
    ]);
    if (stateError) throw stateError;
    if (pendingError) throw pendingError;
    const pending = (pendingRows ?? []) as PendingSegment[];

    // ---------- ① 자체 스냅샷 ----------
    const now = Date.now();
    const takenAt = new Date(now).toISOString();
    const file = await getFileState(token, doc.external_id);
    let snapshot: SyncResult["snapshot"] = "unchanged";
    let segment: {
      periodStart: number;
      text: string;
      added: number;
      removed: number;
      fragments: ChangeFragment[];
      truncated: number;
    } | null = null;
    let since = ms(state.snapshot_since);

    if (state.snapshot_text === null) {
      const text = await exportCurrentText(token, doc.external_id, doc.mime_type);
      await rpc(admin, "set_snapshot_state", {
        p_external_doc_id: doc.id,
        p_expected_at: null,
        p_text: text,
        p_drive_modified_at: file.modifiedTime,
        p_taken_at: takenAt,
      });
      // 형광펜 기준선: 여기서 처음 보이는 글자는 "기록 이전" (blame.ts)
      const { error: baseError } = await admin
        .from("external_docs")
        .update({ blame_base_text: text, blame_base_at: takenAt })
        .eq("id", doc.id)
        .is("blame_base_text", null);
      if (baseError) console.warn("blame base not saved", doc.id, baseError.message);
      snapshot = "baseline";
      since = now;
    } else if (refreshSnapshot || ms(file.modifiedTime) !== ms(state.snapshot_modified_at)) {
      const text = await exportCurrentText(token, doc.external_id, doc.mime_type);
      const changes = diffWithFragments(state.snapshot_text, text);
      if (changes.added + changes.removed > 0) {
        segment = { periodStart: ms(state.snapshot_at)!, text, ...changes };
      } else {
        // 서식만 바뀐 경우 등: 기준만 앞으로
        await rpc(admin, "set_snapshot_state", {
          p_external_doc_id: doc.id,
          p_expected_at: state.snapshot_at,
          p_text: text,
          p_drive_modified_at: file.modifiedTime,
          p_taken_at: takenAt,
        });
      }
    }

    // ---------- ② 소급할 revision (첫 스냅샷 이전만) ----------
    const revisions = await listRevisions(token, doc.external_id);
    const seen = new Map<string, boolean>(
      state.external_doc_revisions.map((r: { external_revision_id: string; text_available: boolean }) => [
        r.external_revision_id,
        r.text_available,
      ]),
    );
    const backlog = revisions
      .map((revision, index) => ({ revision, previous: revisions[index - 1] ?? null }))
      .filter(({ revision }) => !seen.has(revision.id) && (since === null || Date.parse(revision.modifiedTime) <= since));
    const batch = backlog.slice(0, SYNC_BATCH);

    // ---------- ③ 필요한 구간의 편집 이벤트를 한 번에 조회 ----------
    const starts: (number | null)[] = [
      ...(segment ? [segment.periodStart] : []),
      ...pending.map((p) => ms(p.period_start)),
      ...(batch.length ? [batch[0].previous ? Date.parse(batch[0].previous.modifiedTime) : null] : []),
    ];
    let spans: EditSpan[] | null = null;
    let activityRetryable = false;
    const earliest = starts.includes(null) ? null : Math.min(...(starts as number[])) - ACTIVITY_LAG_MS;
    if (starts.length > 0) {
      try {
        spans = await queryEditActivity(token, doc.external_id, earliest);
      } catch (e) {
        activityRetryable =
          !(e instanceof GoogleApiError) || e.status === 408 || e.status === 429 || e.status >= 500;
        console.warn("google activity unavailable", doc.id, e instanceof GoogleApiError ? e.status : e);
      }
    }
    const activity: SyncResult["activity"] = starts.length === 0 ? undefined : spans ? "ok" : "unavailable";

    // ---------- 제안으로 이미 정확히 기록된 부분은 빼기 (suggestionSync.ts) ----------
    // 수락된 제안 글자는 스냅샷 diff에도 다시 나타나므로 구간 합계에서 빼고,
    // 수락 API 호출이 "연결한 사람의 편집"으로 Activity에 찍히는 것도 배분에서 뺀다.
    const accepted = segment || pending.length ? await loadAcceptedSuggestions(admin, doc.id, earliest) : [];
    if (spans && accepted.length) spans = await withoutAcceptEdits(admin, doc.linked_by, spans, accepted);
    if (segment && accepted.length) {
      const fromSuggestions = suggestionTotals(accepted, segment.periodStart, now);
      segment.added = Math.max(0, segment.added - fromSuggestions.added);
      segment.removed = Math.max(0, segment.removed - fromSuggestions.removed);
    }

    if (segment) {
      const segmentId = await rpc<string | null>(admin, "record_snapshot_segment", {
        p_external_doc_id: doc.id,
        p_period_start: state.snapshot_at,
        p_taken_at: takenAt,
        p_drive_modified_at: file.modifiedTime,
        p_permission_id: file.lastModifyingUser?.permissionId ?? null,
        p_display_name: file.lastModifyingUser?.displayName ?? null,
        p_email: file.lastModifyingUser?.emailAddress ?? null,
        p_chars_added: segment.added,
        p_chars_removed: segment.removed,
        p_new_text: segment.text,
        p_credits: spans ? attribute({ start: segment.periodStart, end: now }, spans, segment) : null,
        // 일시 오류의 fallback은 다음 동기화에서 다시 배분한다.
        p_final: spans === null && !activityRetryable,
      });
      if (segmentId) await saveChanges(admin, segmentId, segment, segment.text);
      snapshot = "recorded";
    }

    // ---------- ④ 미확정 스냅샷 구간 재배분 ----------
    if (spans) {
      for (const p of pending) {
        await rpc(admin, "set_revision_credits", {
          p_revision_id: p.id,
          p_credits: attribute({ start: ms(p.period_start), end: Date.parse(p.modified_at) }, spans, {
            added: p.chars_added,
            removed: p.chars_removed,
          }),
          p_final: now - Date.parse(p.modified_at) >= SETTLE_MS,
        });
      }
    }

    // ---------- ② revision 소급 기록 ----------
    let baselineId: string | null = state.last_revision_id;
    // 이전 동기화에서 본문이 없었다면 last_text는 더 오래된 버전의 본문이다.
    let baseline: string | null =
      baselineId === null || seen.get(baselineId) === true ? state.last_text : null;
    const latestId = revisions.at(-1)?.id;
    // 과거 revision은 재배분 대상이 아니므로 Activity가 복구된 뒤에 기록한다.
    const revisionsToRecord = activityRetryable ? [] : batch;
    for (const { revision: rev, previous } of revisionsToRecord) {
      const text = await exportRevisionText(token, doc.external_id, doc.mime_type, rev, rev.id === latestId);
      const changes =
        text !== null && baseline !== null && baselineId === (previous?.id ?? null)
          ? diffWithFragments(baseline, text)
          : { added: 0, removed: 0, fragments: [], truncated: 0 };
      const periodStart = previous ? Date.parse(previous.modifiedTime) : null;
      const revisionId = await rpc<string | null>(admin, "record_external_revision", {
        p_external_doc_id: doc.id,
        p_revision_id: rev.id,
        p_modified_at: rev.modifiedTime,
        p_permission_id: rev.lastModifyingUser?.permissionId ?? null,
        p_display_name: rev.lastModifyingUser?.displayName ?? null,
        p_email: rev.lastModifyingUser?.emailAddress ?? null,
        p_chars_added: changes.added,
        p_chars_removed: changes.removed,
        p_text_available: text != null,
        p_new_text: text,
        p_credits: spans ? attribute({ start: periodStart, end: Date.parse(rev.modifiedTime) }, spans, changes) : null,
        p_period_start: previous?.modifiedTime ?? null,
      });
      if (revisionId) await saveChanges(admin, revisionId, changes, text);
      baselineId = rev.id;
      baseline = text;
      processed++;
    }
    if (revisionsToRecord.length === 0 && snapshot === "unchanged") {
      await rpc(admin, "touch_external_doc_synced", { p_external_doc_id: doc.id });
    }

    const remaining = activityRetryable ? 0 : backlog.length - processed;
    return { ...base, processed, remaining, snapshot, activity };
  } catch (e) {
    // 캐시된 토큰이 취소됨(연결 해제 후 재연결 등) → 버리고 다음 호출에서 새로 발급
    if (e instanceof GoogleApiError && e.status === 401) forgetCachedToken(doc.linked_by);
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return { ...base, processed, error: "file_access_lost" };
    }
    console.error("google sync failed", doc.id, e);
    return { ...base, processed, error: "google_error" };
  }
}

type AcceptedSuggestion = { accepted_at: string; chars_added: number; chars_removed: number };
/** 수락 API 호출 전후로 이 시간 안의 "연결한 사람" 편집은 수락 동작으로 봄 */
const ACCEPT_WINDOW_MS = 15_000;

async function loadAcceptedSuggestions(admin: SupabaseClient, docId: string, sinceMs: number | null) {
  let query = admin
    .from("external_doc_suggestions")
    .select("accepted_at, chars_added, chars_removed")
    .eq("external_doc_id", docId)
    .eq("status", "accepted");
  if (sinceMs !== null) query = query.gte("accepted_at", new Date(sinceMs).toISOString());
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AcceptedSuggestion[];
}

function suggestionTotals(rows: AcceptedSuggestion[], startMs: number, endMs: number) {
  return rows
    .filter((r) => {
      const t = Date.parse(r.accepted_at);
      return t > startMs && t <= endMs;
    })
    .reduce((a, r) => ({ added: a.added + r.chars_added, removed: a.removed + r.chars_removed }), { added: 0, removed: 0 });
}

async function withoutAcceptEdits(
  admin: SupabaseClient,
  linkerId: string,
  spans: EditSpan[],
  accepted: AcceptedSuggestion[],
): Promise<EditSpan[]> {
  const { data } = await admin.from("google_accounts").select("activity_person_id").eq("user_id", linkerId).maybeSingle();
  const linker = data?.activity_person_id;
  if (!linker) return spans;
  const times = accepted.map((r) => Date.parse(r.accepted_at));
  return spans.filter(
    (s) =>
      s.personId !== linker ||
      !times.some((t) => s.start <= t + ACCEPT_WINDOW_MS && s.end >= t - ACCEPT_WINDOW_MS),
  );
}

async function rpc<T = unknown>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** 어디가 바뀌었는지 + 구간 끝 본문 (구간 기록 직후, 새로 기록된 경우에만) */
async function saveChanges(
  admin: SupabaseClient,
  revisionId: string,
  diff: { fragments: ChangeFragment[]; truncated: number },
  textAfter: string | null,
) {
  await rpc(admin, "set_revision_changes", {
    p_revision_id: revisionId,
    p_changes: diff.fragments,
    p_truncated: diff.truncated,
  });
  if (textAfter === null) return;
  // 미리보기 형광펜용 (blame.ts가 시간 순서로 다시 diff)
  // 실패해도 기여 기록은 유지 (형광펜만 "기록 이전"으로 보임)
  const { error } = await admin.from("external_doc_revisions").update({ text_after: textAfter }).eq("id", revisionId);
  if (error) console.warn("blame text not saved", revisionId, error.message);
}
