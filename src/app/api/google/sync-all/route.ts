// GET /api/google/sync-all — 크론용 전체 동기화 (Authorization: Bearer $CRON_SECRET)
import { NextResponse, type NextRequest } from "next/server";
import { ensureTeamAccess } from "@/lib/google/share";
import { EXTERNAL_DOC_COLUMNS, syncExternalDoc, type ExternalDocRow } from "@/lib/google/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_EXTERNAL_ID_PATTERN } from "@/lib/google/demo";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: docs } = await admin
    .from("external_docs")
    .select(EXTERNAL_DOC_COLUMNS)
    .not("external_id", "like", DEMO_EXTERNAL_ID_PATTERN)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(50);
  const results = [];
  const rows = (docs ?? []) as ExternalDocRow[];
  for (const doc of rows) results.push(await syncExternalDoc(admin, doc));

  // 누락 권한 보정 (화면을 아무도 안 열어도 팀원 권한이 맞춰지도록)
  let granted = 0;
  for (const teamId of new Set(rows.map((d) => d.team_id))) {
    const ids = rows.filter((d) => d.team_id === teamId).map((d) => d.id);
    granted += (await ensureTeamAccess(admin, teamId, { docIds: ids }).catch(() => ({ granted: 0 }))).granted;
  }
  return NextResponse.json({ results, shareGranted: granted });
}
