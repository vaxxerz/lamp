// POST /api/google/share { teamId } — 호출자 본인의 구글 문서 접근을 팀 멤버십에 맞춘다.
//  팀원이면 연결된 모든 문서의 편집자로 추가, 팀원이 아니면(탈퇴 후 호출) 권한 회수.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/lib/google/session";
import { ensureTeamAccess, revokeMemberAccess } from "@/lib/google/share";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const Body = z.object({ teamId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId } = parsed.data;

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();

  const mode = member ? "grant" : "revoke";
  const result = member
    ? await ensureTeamAccess(admin, teamId, { userIds: [userId] })
    : await revokeMemberAccess(admin, teamId, userId);
  return NextResponse.json({ mode, ...result });
}
