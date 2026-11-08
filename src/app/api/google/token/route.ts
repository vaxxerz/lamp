// GET /api/google/token — Google Picker용 access token (본인 것, drive.file 스코프)
import { NextResponse } from "next/server";
import { getUserAccessToken } from "@/lib/google/oauth";
import { currentUserId } from "@/lib/google/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const accessToken = await getUserAccessToken(createAdminClient(), userId);
  if (!accessToken) return NextResponse.json({ error: "not_connected" }, { status: 404 });
  return NextResponse.json({ accessToken }, { headers: { "Cache-Control": "no-store" } });
}
