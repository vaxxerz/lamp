"use client";
// 문서 분석 화면 — 문서 탭 목록에서 문서를 눌러 들어옴
//  왼쪽: 작성자별 형광펜 미리보기 / 오른쪽: 통계 · 분석 (DocInsightView)
//  실데이터: 해당 문서의 본문이나 기여 기록이 저장되면 다시 불러옴
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, RefreshCw } from "lucide-react";
import { useGoogleDocs } from "@/components/google/useGoogleDocs";
import type { DocInsight } from "@/lib/google/insight";
import { demoInsight } from "@/lib/google/insightDemo";
import { createClient } from "@/lib/supabase/client";
import { DocInsightView } from "./DocInsightView";
import { useStudent } from "./StudentProvider";

function BackLink() {
  return (
    <Link className="lamp-text-button lamp-insight-back" href="/lamp/documents">
      <ArrowLeft size={14} /> 문서 목록
    </Link>
  );
}

function HistoryLink({ docId }: { docId: string }) {
  return (
    <Link className="lamp-button secondary" href={`/lamp/activities?doc=${docId}`}>
      <History size={14} /> 수정 기록
    </Link>
  );
}

/** 문서 미리보기 데이터 + 실시간 갱신 (학생 · 교수 공용) */
export function useDocInsight(docId: string, version: string | null) {
  const [supabase] = useState(createClient);
  const [refreshCount, setRefreshCount] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    insight: DocInsight | null;
    error: string | null;
  }>({ key: null, insight: null, error: null });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRefreshCount((count) => count + 1), 300);
    };
    const schema = "public";
    const docFilter = `external_doc_id=eq.${docId}`;
    const channel = supabase
      .channel(`google-doc-insight-${docId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema, table: "external_docs", filter: `id=eq.${docId}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*", schema, table: "external_doc_revisions", filter: docFilter,
      }, refresh)
      .on("postgres_changes", {
        event: "*", schema, table: "external_doc_credits",
      }, refresh)
      .on("postgres_changes", {
        event: "*", schema, table: "external_doc_suggestions", filter: docFilter,
      }, (event) => {
        if (event.eventType !== "DELETE" && event.new.status === "accepted") refresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [docId, supabase]);

  const key = `${docId}@${version ?? ""}:${refreshCount}`;
  useEffect(() => {
    let active = true;
    fetch(`/api/google/docs/${docId}/insight`)
      .then(async (res) => {
        if (res.status === 404) throw new Error("not_found");
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as DocInsight;
      })
      .then((insight) => active && setState({ key, insight, error: null }))
      .catch(
        (e: Error) =>
          active &&
          setState((s) => ({
            key,
            insight: s.insight,
            error:
              e.message === "not_found"
                ? "문서를 찾을 수 없어요. 연결이 해제됐거나 볼 권한이 없어요."
                : "문서 미리보기를 불러오지 못했어요.",
          })),
      );
    return () => {
      active = false;
    };
  }, [docId, key]);
  return { insight: state.insight, loading: state.key !== key, error: state.error };
}

function LiveDetail({ docId }: { docId: string }) {
  const { ws } = useStudent();
  const g = useGoogleDocs(ws.team.id);
  const doc = g.docs.find((d) => d.id === docId);
  const preview = useDocInsight(docId, doc?.last_synced_at ?? null);
  return (
    <>
      <div className="lamp-insight-top">
        <BackLink />
        <div className="lamp-actions">
          <HistoryLink docId={docId} />
          <button
            className="lamp-button secondary"
            onClick={() => void g.sync(true)}
            disabled={!!g.busy}
          >
            <RefreshCw size={14} className={g.busy === "sync" ? "lamp-spin" : undefined} />
            {g.busy === "sync" ? "동기화 중…" : "동기화"}
          </button>
        </div>
      </div>
      <DocInsightView insight={preview.insight} loading={preview.loading} error={preview.error} />
    </>
  );
}

function MockDetail({ docId }: { docId: string }) {
  const { ws } = useStudent();
  const doc = ws.documents.find((d) => d.id === docId);
  // 예시 데이터도 실제와 같은 계산으로 (diff는 브라우저에서)
  const demo = useMemo(() => (doc?.type === "docs" ? demoInsight(doc.id, doc.name) : null), [doc]);
  return (
    <>
      <div className="lamp-insight-top">
        <BackLink />
        <HistoryLink docId={docId} />
      </div>
      <DocInsightView
        insight={demo}
        error={
          !doc
            ? "문서를 찾을 수 없어요."
            : !demo
              ? "예시 화면에서는 Google 문서(Docs)만 미리볼 수 있어요."
              : null
        }
      />
    </>
  );
}

export function DocumentDetail({ docId }: { docId: string }) {
  const { ws } = useStudent();
  return ws.mode === "live" ? <LiveDetail docId={docId} /> : <MockDetail docId={docId} />;
}
