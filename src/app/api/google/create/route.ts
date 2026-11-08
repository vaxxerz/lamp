// POST /api/google/create { teamId, kind, title } — 램프에서 새 구글 문서를 만들어 팀에 연결하고 팀원 전원에게 공유
//  내 드라이브에 생성되며(소유자 = 만든 사람) 앱이 만든 파일이라 drive.file 범위로 공유까지 가능
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createGoogleFile, GOOGLE_MIME } from "@/lib/google/drive";
import { linkDocToTeam } from "@/lib/google/linkDoc";
import { getUserAccessToken } from "@/lib/google/oauth";
import { currentUserId } from "@/lib/google/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const Body = z.object({
  teamId: z.string().uuid(),
  kind: z.enum(["document", "presentation", "spreadsheet"]),
  title: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId, kind, title } = parsed.data;

  const admin = createAdminClient();
  // 팀원만 생성 가능 (드라이브에 파일을 만들기 전에 확인)
  const { data: member } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "not_team_member" }, { status: 403 });

  const token = await getUserAccessToken(admin, userId);
  if (!token) return NextResponse.json({ error: "not_connected" }, { status: 400 });

  let file;
  try {
    file = await createGoogleFile(token, title, GOOGLE_MIME[kind]);
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 502 });
  }

  const r = await linkDocToTeam(admin, teamId, userId, file);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ externalDocId: r.externalDocId, title: r.title, webUrl: r.webUrl, sync: r.sync, share: r.share });
}
