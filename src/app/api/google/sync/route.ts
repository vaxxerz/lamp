// POST /api/google/sync { teamId, force? } — 팀의 구글 문서 수정 이력 동기화 (팀원·담당 교수)
// remaining > 0 이면 클라이언트가 다시 호출
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/lib/google/session";
import { ensureTeamAccess, type ShareResult } from "@/lib/google/share";
import { EXTERNAL_DOC_COLUMNS, syncExternalDoc, type ExternalDocRow } from "@/lib/google/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEMO_EXTERNAL_ID_PATTERN } from "@/lib/google/demo";

export const maxDuration = 60;
const MIN_INTERVAL_MS = 60_000;

const Body = z.object({ teamId: z.string().uuid(), force: z.boolean().default(false) });

export async function POST(req: NextRequest) {
  if (!(await currentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId, force } = parsed.data;

  // RLS: 팀원 또는 담당 교수만 목록이 보임
  const supabase = await createClient();
  const { data: docs } = await supabase.from("external_docs").select(EXTERNAL_DOC_COLUMNS)
    .eq("team_id", teamId)
    .not("external_id", "like", DEMO_EXTERNAL_ID_PATTERN);
  const due = ((docs ?? []) as ExternalDocRow[]).filter(
    (d) => force || !d.last_synced_at || Date.now() - Date.parse(d.last_synced_at) > MIN_INTERVAL_MS,
  );

  const admin = createAdminClient();
  const results = [];
  for (const doc of due) results.push(await syncExternalDoc(admin, doc));

  // 누락 권한 보정: 동기화 주기(1분)에 맞춰, 이번에 동기화한 문서만 팀원 공유 상태를 점검
  const share: ShareResult =
    due.length > 0
      ? await ensureTeamAccess(admin, teamId, { docIds: due.map((d) => d.id) }).catch(() => ({
          granted: 0,
          revoked: 0,
          failed: [],
        }))
      : { granted: 0, revoked: 0, failed: [] };

  return NextResponse.json({
    results,
    share,
    remaining: results.reduce((n, r) => n + r.remaining, 0),
    skipped: (docs?.length ?? 0) - due.length,
  });
}
