// POST /api/google/suggestions/tick — 제안 자동 기록 · 수락 1회 (Authorization: Bearer $CRON_SECRET)
// scripts/suggestion-worker.mjs 가 2초마다 호출. 구글 "문서"만 대상 (슬라이드 · 시트는 Docs API 미지원)
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_MIME } from "@/lib/google/drive";
import { processSuggestions } from "@/lib/google/suggestionSync";
import { EXTERNAL_DOC_COLUMNS, syncExternalDoc, type ExternalDocRow } from "@/lib/google/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_EXTERNAL_ID_PATTERN } from "@/lib/google/demo";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: docs, error } = await admin
    .from("external_docs")
    .select(EXTERNAL_DOC_COLUMNS)
    .eq("mime_type", GOOGLE_MIME.document)
    .not("external_id", "like", DEMO_EXTERNAL_ID_PATTERN);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await Promise.all(
    ((docs ?? []) as ExternalDocRow[]).map(async (doc) => {
      const result = await processSuggestions(admin, doc);
      if (result.accepted === 0) return result;

      const snapshot = await syncExternalDoc(admin, doc, { refreshSnapshot: true });
      return snapshot.error ? { ...result, error: snapshot.error } : result;
    }),
  );
  return NextResponse.json({ results: results.filter((r) => r.seen > 0 || r.error) });
}
