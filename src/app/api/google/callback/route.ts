// GET /api/google/callback — 코드 교환 → 구글 계정 정보 → 토큰 암호화 저장 → 과거 이력 소급
import { NextResponse, type NextRequest } from "next/server";
import { encryptToken } from "@/lib/google/crypto";
import { getAbout } from "@/lib/google/drive";
import {
  DRIVE_FILE_SCOPE,
  exchangeCode,
  forgetCachedToken,
  googleRedirectUri,
  idTokenSubject,
} from "@/lib/google/oauth";
import { currentUserId, safeReturnTo } from "@/lib/google/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  let saved: { state?: string; returnTo?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get("g_oauth")?.value ?? "{}");
  } catch {}
  const returnTo = safeReturnTo(saved.returnTo);
  const back = (status: string, extra: Record<string, string> = {}) => {
    const url = new URL(returnTo, req.url);
    url.searchParams.set("google", status);
    Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: "g_oauth", path: "/api/google" });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code || !saved.state || params.get("state") !== saved.state) return back("invalid_state");

  const userId = await currentUserId();
  if (!userId) return back("unauthorized");

  try {
    const tokens = await exchangeCode(code, googleRedirectUri(req.nextUrl.origin));
    if (!tokens.scope.split(" ").includes(DRIVE_FILE_SCOPE)) return back("scope_denied");
    if (!tokens.refresh_token) return back("no_refresh_token");

    const about = await getAbout(tokens.access_token);
    if (!about.permissionId || !about.emailAddress) return back("google_error");

    const { data: credited, error } = await createAdminClient().rpc("save_google_account", {
      p_user_id: userId,
      p_google_email: about.emailAddress,
      p_permission_id: about.permissionId,
      p_display_name: about.displayName ?? null,
      p_refresh_token_enc: encryptToken(tokens.refresh_token),
      p_scope: tokens.scope,
      p_person_id: idTokenSubject(tokens.id_token),
    });
    if (error) return back(error.message === "google_account_in_use" ? "in_use" : "error");
    // 이름으로 매칭 못 했던 제안 기록 소급 (구글 문서 제안 자동 수락)
    const { data: suggestions } = await createAdminClient().rpc("credit_pending_suggestions", { p_user_id: userId });
    forgetCachedToken(userId);
    return back("connected", { credited: String((credited ?? 0) + (suggestions ?? 0)) });
  } catch (e) {
    console.error("google callback failed", e);
    return back("error");
  }
}
