"use client";
// 팀의 구글 문서 연동 상태 · 기록 · 동작 (문서 탭과 예전 GoogleDocsPanel 공용)
//  화면 진입 시 동기화, 열려 있는 동안 90초마다 스냅샷, 제안 기록은 Supabase Realtime으로 즉시 반영
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickGoogleFile } from "@/lib/google/picker";
import { createClient } from "@/lib/supabase/client";
import { watchWorkspaceChanges } from "@/lib/workspace-refresh";

export type ExternalDoc = {
  id: string;
  title: string;
  mime_type: string;
  web_url: string | null;
  last_synced_at: string | null;
  linked_by: string;
};
export type Revision = {
  id: string;
  external_doc_id: string;
  modified_at: string;
  google_display_name: string | null;
  chars_added: number;
  chars_removed: number;
  text_available: boolean;
  source: "revision" | "snapshot";
  author: { name: string } | null;
  credits: Credit[];
  changes: ChangeFragment[];
  changes_truncated: number;
};
export type ChangeFragment = {
  op: "insert" | "delete" | "replace";
  line: number;
  added?: string;
  removed?: string;
  before: string;
  after: string;
};
export type Credit = {
  chars_added: number;
  chars_removed: number;
  share: number;
  confidence: "single" | "shared" | "fallback";
  display_name: string | null;
  edited_from: string | null;
  edited_to: string | null;
  author: { name: string } | null;
};
export type MemberStatus = {
  user_id: string;
  name: string;
  connected: boolean;
};

/** 화면 표시용: 배분 행이 없으면(이전 버전 데이터) revision 작성자 1명 */
export type CreditView = {
  name: string;
  added: number;
  share: number;
  confidence: Credit["confidence"];
  from: string | null;
  to: string | null;
};

export function creditsOf(r: Revision): CreditView[] {
  if (r.credits.length === 0) {
    return [
      {
        name: r.author?.name ?? `${r.google_display_name ?? "?"} (미연결)`,
        added: r.chars_added,
        share: 1,
        confidence: "fallback",
        from: null,
        to: null,
      },
    ];
  }
  return [...r.credits]
    .sort((a, b) => b.share - a.share)
    .map((c) => ({
      name:
        c.author?.name ??
        `${c.display_name ?? r.google_display_name ?? "?"} (미연결)`,
      added: c.chars_added,
      share: c.share,
      confidence: c.confidence,
      from: c.edited_from,
      to: c.edited_to,
    }));
}

export const AUTO_SYNC_MS = 90_000; // 화면이 열려 있는 동안 자체 스냅샷 주기

export const ICON: Record<string, string> = {
  "application/vnd.google-apps.document": "📄",
  "application/vnd.google-apps.presentation": "📊",
  "application/vnd.google-apps.spreadsheet": "📈",
};

export const STATUS_MESSAGE: Record<string, string> = {
  connected: "구글 계정이 연결됐어요.",
  denied: "구글 연결을 취소했어요.",
  scope_denied: "드라이브 파일 권한을 허용해야 연결돼요. 다시 시도해 주세요.",
  in_use: "이미 다른 사용자가 연결한 구글 계정이에요.",
  invalid_state: "연결 요청이 만료됐어요. 다시 시도해 주세요.",
  error: "구글 연결 중 오류가 났어요.",
};

/** 팀원 자동 공유가 실패한 건 (서버 lib/google/share.ts 의 ShareFailure) */
export type ShareIssue = {
  externalDocId: string;
  title: string;
  memberName: string | null;
  reason: string;
};

export const SHARE_REASON: Record<string, string> = {
  no_share_permission:
    "문서를 연결한 팀원에게 공유 권한이 없어요. 문서 소유자가 직접 공유하거나, 소유자가 다시 연결해 주세요.",
  domain_policy: "학교 구글 계정 정책으로 외부 공유가 막혀 있어요. 한양 구글 계정끼리만 공유돼요.",
  invalid_recipient: "구글 계정이 아닌 이메일이라 공유할 수 없어요. 한양 구글 계정으로 드라이브를 연결해 주세요.",
  linker_not_connected: "문서를 연결한 팀원의 구글 연결이 끊겼어요. 그 팀원이 다시 연결하면 자동으로 공유돼요.",
  no_email: "팀원의 구글 이메일을 알 수 없어요. 그 팀원이 드라이브를 연결하면 자동으로 공유돼요.",
  file_not_found: "문서를 찾을 수 없어요. 삭제됐거나 연결한 팀원의 접근 권한이 사라졌어요.",
  error: "구글 공유 중 오류가 났어요. 잠시 뒤 다시 동기화해 주세요.",
};

/** 같은 사유는 한 줄로 묶어서 보여줌 */
export function groupShareIssues(issues: ShareIssue[]) {
  const groups = new Map<string, { reason: string; title: string; names: string[]; docId: string }>();
  for (const i of issues) {
    const key = `${i.externalDocId}:${i.reason}`;
    const g = groups.get(key) ?? { reason: i.reason, title: i.title, names: [], docId: i.externalDocId };
    if (i.memberName && !g.names.includes(i.memberName)) g.names.push(i.memberName);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    text: SHARE_REASON[g.reason] ?? SHARE_REASON.error,
  }));
}

export type NewDocKind = "document" | "presentation" | "spreadsheet";

/** 제안 모드로 쓴 수정 — 작성자가 정확히 기록되고 워커가 바로 수락 */
export type Suggestion = {
  id: string;
  external_doc_id: string;
  added_text: string;
  removed_text: string;
  chars_added: number;
  chars_removed: number;
  author_name: string | null;
  suggested_at: string | null;
  accepted_at: string;
  author: { name: string } | null;
};

export type PanelData = {
  myGoogle: string | null;
  docs: ExternalDoc[];
  revisions: Revision[];
  suggestions: Suggestion[];
  members: MemberStatus[];
};

export async function fetchPanelData(
  supabase: SupabaseClient,
  teamId: string,
): Promise<PanelData> {
  const [ga, d, r, m, s] = await Promise.all([
    supabase.from("google_accounts").select("google_email").maybeSingle(),
    supabase
      .from("external_docs")
      .select("id, title, mime_type, web_url, last_synced_at, linked_by")
      .eq("team_id", teamId)
      .order("created_at"),
    supabase
      .from("external_doc_revisions")
      .select(
        "id, external_doc_id, modified_at, google_display_name, chars_added, chars_removed, text_available, source, author:profiles!external_doc_revisions_author_id_fkey(name), changes, changes_truncated, credits:external_doc_credits(chars_added, chars_removed, share, confidence, display_name, edited_from, edited_to, author:profiles!external_doc_credits_author_id_fkey(name))",
      )
      .eq("team_id", teamId)
      .order("modified_at", { ascending: false })
      .limit(100),
    supabase.rpc("get_team_google_status", { p_team_id: teamId }),
    supabase
      .from("external_doc_suggestions")
      .select(
        "id, external_doc_id, added_text, removed_text, chars_added, chars_removed, author_name, suggested_at, accepted_at, author:profiles!external_doc_suggestions_author_id_fkey(name)",
      )
      .eq("team_id", teamId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(100),
  ]);
  return {
    myGoogle: ga.data?.google_email ?? null,
    docs: (d.data ?? []) as ExternalDoc[],
    revisions: (r.data ?? []) as unknown as Revision[],
    suggestions: (s.data ?? []) as unknown as Suggestion[],
    members: (m.data ?? []) as MemberStatus[],
  };
}

export const suggestionAuthor = (x: Suggestion) =>
  x.author?.name ?? `${x.author_name ?? "?"} (미연결)`;

function shareSummary(base: string, share?: { granted: number; failed: unknown[] }) {
  if (!share) return base;
  if (share.failed.length > 0) return `${base} 일부 팀원에게는 공유하지 못했어요 — 아래 안내를 확인해 주세요.`;
  if (share.granted > 0) return `${base} 팀원 ${share.granted}명에게 편집 권한을 줬어요.`;
  return base;
}

export function useGoogleDocs(teamId: string) {
  const [supabase] = useState(createClient);
  const googleStatus = useSearchParams().get("google");
  const credited = useSearchParams().get("credited");

  const [myGoogle, setMyGoogle] = useState<string | null | undefined>(
    undefined,
  );
  const [docs, setDocs] = useState<ExternalDoc[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [members, setMembers] = useState<MemberStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [shareIssues, setShareIssues] = useState<ShareIssue[]>([]);
  /** 점검한 문서의 결과로 교체 (점검하지 않은 문서의 기존 안내는 유지) */
  const mergeShareIssues = useCallback((checked: string[], failed: ShareIssue[] | undefined) => {
    const done = new Set(checked);
    setShareIssues((prev) => [...prev.filter((i) => !done.has(i.externalDocId)), ...(failed ?? [])]);
  }, []);
  const [message, setMessage] = useState<string | null>(
    googleStatus
      ? (STATUS_MESSAGE[googleStatus] ?? STATUS_MESSAGE.error) +
          (credited && credited !== "0"
            ? ` 과거 수정 ${credited}건이 내 기여로 반영됐어요.`
            : "")
      : null,
  );

  const apply = useCallback((d: PanelData) => {
    setMyGoogle(d.myGoogle);
    setDocs(d.docs);
    setRevisions(d.revisions);
    setSuggestions(d.suggestions);
    setMembers(d.members);
  }, []);
  const load = useCallback(
    () => fetchPanelData(supabase, teamId).then(apply),
    [supabase, teamId, apply],
  );

  const sync = useCallback(
    async (force: boolean) => {
      setBusy("sync");
      try {
        // 남은 revision이 있으면 몇 번 더 호출 (한 번에 문서당 25개)
        for (let i = 0; i < 8; i++) {
          const res = await fetch("/api/google/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamId, force: force || i > 0 }),
          });
          const json = await res.json();
          const results = (json.results ?? []) as {
            externalDocId: string;
            error?: string;
            activity?: string;
          }[];
          if (json.share)
            mergeShareIssues(
              results.map((r) => r.externalDocId),
              json.share.failed,
            );
          if (results.some((r) => r.error)) {
            setMessage(
              "일부 문서를 동기화하지 못했어요. 문서를 연결한 팀원의 구글 연결을 확인해 주세요.",
            );
          } else if (results.some((r) => r.activity === "unavailable")) {
            setMessage(
              "편집자별 활동 기록을 읽지 못해 마지막 수정자 기준으로 기록했어요. 문서를 연결한 팀원이 구글 연결을 해제 후 다시 연결하면 정밀하게 나눠져요.",
            );
          }
          if (!json.remaining) break;
        }
      } finally {
        setBusy(null);
        await load();
      }
    },
    [load, teamId, mergeShareIssues],
  );

  useEffect(() => {
    // 화면 진입 시 로드 + 자동 동기화 (서버가 1분 내 중복 요청은 건너뜀)
    let active = true;
    fetchPanelData(supabase, teamId).then((d) => {
      if (!active) return;
      apply(d);
      return sync(false);
    });
    // 열려 있는 동안 주기적으로 스냅샷 → 구간이 짧아져 편집자가 섞일 일이 줄어듦
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync(false);
    }, AUTO_SYNC_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [supabase, teamId, apply, sync]);

  useEffect(() => {
    return watchWorkspaceChanges(supabase, async () => {
      try {
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "문서 목록을 불러오지 못했어요.");
      }
    });
  }, [supabase, teamId, load]);

  async function addDoc() {
    setBusy("add");
    setMessage(null);
    try {
      const tokenRes = await fetch("/api/google/token");
      if (!tokenRes.ok) return setMessage("먼저 구글 계정을 연결해 주세요.");
      const { accessToken } = await tokenRes.json();
      const fileId = await pickGoogleFile(accessToken);
      if (!fileId) return;
      const res = await fetch("/api/google/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, fileId }),
      });
      const json = await res.json();
      if (!res.ok)
        return setMessage(`문서를 연결하지 못했어요 (${json.error}).`);
      setMessage(shareSummary(`"${json.title}" 문서를 연결했어요.`, json.share));
      mergeShareIssues([json.externalDocId], json.share?.failed);
      if (json.sync?.remaining) await sync(true);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
      await load();
    }
  }

  /** 램프에서 새 구글 문서를 만들어 연결 (팀원 전원에게 자동 공유). 성공 시 문서 URL */
  async function createDoc(kind: NewDocKind, title: string): Promise<string | null> {
    setBusy("create");
    setMessage(null);
    try {
      const res = await fetch("/api/google/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, kind, title }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(
          json.error === "not_connected"
            ? "먼저 구글 계정을 연결해 주세요."
            : `문서를 만들지 못했어요 (${json.error}).`,
        );
        return null;
      }
      setMessage(shareSummary(`"${json.title}" 문서를 만들었어요.`, json.share));
      mergeShareIssues([json.externalDocId], json.share?.failed);
      return (json.webUrl as string | null) ?? null;
    } catch (e) {
      setMessage(String(e));
      return null;
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function disconnect() {
    if (!confirm("구글 연결을 해제할까요? 이미 반영된 기여는 유지돼요."))
      return;
    await fetch("/api/google/disconnect", { method: "POST" });
    await load();
  }

  return {
    myGoogle,
    docs,
    revisions,
    suggestions,
    members,
    busy,
    message,
    setMessage,
    load,
    sync,
    addDoc,
    createDoc,
    disconnect,
    shareIssues,
  };
}
