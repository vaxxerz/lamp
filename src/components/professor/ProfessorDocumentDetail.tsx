"use client";
// 교수 화면의 문서 분석 — 학생 문서 분석(DocumentDetail)과 같은 미리보기 · 통계 (읽기 전용, 동기화 없음)
//  실데이터: /api/google/docs/:id/insight (RLS로 담당 교수도 읽을 수 있음) · Mock: 예시 구간 기록으로 같은 계산
import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft, History } from "lucide-react";
import type { ConnectedDocument } from "@/lib/student/types";
import { demoInsight } from "@/lib/google/insightDemo";
import { DocInsightView } from "@/components/student/DocInsightView";
import { useDocInsight } from "@/components/student/DocumentDetail";

function Top({ base, docId }: { base: string; docId: string }) {
  return (
    <div className="lamp-insight-top">
      <Link className="lamp-text-button lamp-insight-back" href={`${base}/documents`}>
        <ArrowLeft size={14} /> 문서 목록
      </Link>
      <Link
        className="lamp-button secondary"
        href={`${base}/activities?doc=${encodeURIComponent(docId)}`}
      >
        <History size={14} /> 수정 기록
      </Link>
    </div>
  );
}

function LiveDetail({ docId, doc }: { docId: string; doc?: ConnectedDocument }) {
  const preview = useDocInsight(docId, doc?.updatedAt ?? null);
  return (
    <DocInsightView
      insight={preview.insight}
      loading={preview.loading}
      error={preview.error}
      readOnly
    />
  );
}

function MockDetail({ doc }: { doc?: ConnectedDocument }) {
  const demo = useMemo(
    () => (doc?.type === "docs" ? demoInsight(doc.id, doc.name) : null),
    [doc],
  );
  return (
    <DocInsightView
      insight={demo}
      readOnly
      error={
        !doc
          ? "문서를 찾을 수 없어요."
          : !demo
            ? "예시 화면에서는 Google 문서(Docs)만 미리볼 수 있어요."
            : null
      }
    />
  );
}

export function ProfessorDocumentDetail({
  base,
  docId,
  docs,
  live,
}: {
  /** 팀 화면 주소 (/professor/teams/:id) */
  base: string;
  docId: string;
  docs: ConnectedDocument[];
  live: boolean;
}) {
  const doc = docs.find((d) => d.id === docId);
  return (
    <>
      <Top base={base} docId={docId} />
      {live ? <LiveDetail docId={docId} doc={doc} /> : <MockDetail doc={doc} />}
    </>
  );
}
