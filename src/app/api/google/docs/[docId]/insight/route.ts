// GET /api/google/docs/:docId/insight — 연결된 구글 문서의 미리보기 형광펜 + 편집자별 통계
//  RLS로 팀원 · 담당 교수만 읽을 수 있음 (사용자 세션 클라이언트로 조회)
import { NextResponse, type NextRequest } from "next/server";
import { buildInsight, type DocRow, type RevisionRow, type SuggestionRow } from "@/lib/google/insight";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/google/docs/[docId]/insight">) {
  const { docId } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [d, r, s] = await Promise.all([
    supabase
      .from("external_docs")
      .select(
        "id, title, mime_type, web_url, last_synced_at, snapshot_text, last_text, blame_base_text, blame_base_at",
      )
      .eq("id", docId)
      .maybeSingle(),
    supabase
      .from("external_doc_revisions")
      .select(
        "id, modified_at, period_start, source, text_after, chars_added, chars_removed, google_display_name, author_id, author:profiles!external_doc_revisions_author_id_fkey(name), credits:external_doc_credits(author_id, display_name, share, confidence, chars_added, chars_removed, author:profiles!external_doc_credits_author_id_fkey(name))",
      )
      .eq("external_doc_id", docId)
      .order("modified_at"),
    supabase
      .from("external_doc_suggestions")
      .select(
        "id, added_text, chars_added, chars_removed, accepted_at, author_id, author_name, author:profiles!external_doc_suggestions_author_id_fkey(name)",
      )
      .eq("external_doc_id", docId)
      .eq("status", "accepted")
      .order("accepted_at"),
  ]);
  const error = d.error ?? r.error ?? s.error;
  if (error) {
    console.error("doc insight failed", docId, error);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!d.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const insight = buildInsight(
    d.data as DocRow,
    (r.data ?? []) as unknown as RevisionRow[],
    (s.data ?? []) as unknown as SuggestionRow[],
  );
  return NextResponse.json(insight, { headers: { "Cache-Control": "private, no-store" } });
}
