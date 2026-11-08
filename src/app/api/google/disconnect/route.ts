// POST /api/google/disconnect — 구글 연결 해제 (이미 반영된 기여 기록은 유지)
import { NextResponse } from "next/server";
import { decryptToken } from "@/lib/google/crypto";
import { forgetCachedToken, revokeGoogleToken } from "@/lib/google/oauth";
import { currentUserId } from "@/lib/google/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_accounts")
    .select("refresh_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) {
    try {
      await revokeGoogleToken(decryptToken(data.refresh_token_enc));
    } catch {}
    await admin.from("google_accounts").delete().eq("user_id", userId);
  }
  forgetCachedToken(userId);
  return NextResponse.json({ ok: true });
}
