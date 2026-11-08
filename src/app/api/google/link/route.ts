// POST /api/google/link { teamId, fileId } — Picker로 고른 구글 문서를 팀에 연결 + 첫 동기화 + 팀원 자동 공유
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFile, GoogleApiError, SUPPORTED_MIME } from "@/lib/google/drive";
import { linkDocToTeam } from "@/lib/google/linkDoc";
import { getUserAccessToken } from "@/lib/google/oauth";
import { currentUserId } from "@/lib/google/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const Body = z.object({ teamId: z.string().uuid(), fileId: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId, fileId } = parsed.data;

  const admin = createAdminClient();
  const token = await getUserAccessToken(admin, userId);
  if (!token) return NextResponse.json({ error: "not_connected" }, { status: 400 });

  let file;
  try {
    file = await getFile(token, fileId);
  } catch (e) {
    const status = e instanceof GoogleApiError && e.status === 404 ? 404 : 502;
    return NextResponse.json({ error: "file_not_accessible" }, { status });
  }
  if (!SUPPORTED_MIME.includes(file.mimeType)) {
    return NextResponse.json({ error: "unsupported_mime_type" }, { status: 400 });
  }

  const r = await linkDocToTeam(admin, teamId, userId, file);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ externalDocId: r.externalDocId, title: r.title, sync: r.sync, share: r.share });
}
