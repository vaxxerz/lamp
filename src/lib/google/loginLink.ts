// 서버 전용: 한양 구글 로그인과 동시에 드라이브 연동
//  로그인(Supabase 구글 OAuth)에서 drive.file · drive.activity.readonly 범위를 함께 받으면,
//  세션 교환 순간에만 받을 수 있는 provider 토큰을 기존 /api/google/callback 과 같은 방식으로 저장한다.
//  (로그인 · 드라이브 연동이 같은 구글 OAuth 클라이언트라 refresh token을 그대로 쓸 수 있다)
//  실패해도 로그인은 막지 않는다 — 문서 화면의 "한양 구글 계정으로 연결"로 다시 연결할 수 있다.
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "./crypto";
import { getAbout } from "./drive";
import { DRIVE_FILE_SCOPE, forgetCachedToken } from "./oauth";

async function grantedScope(accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { scope?: string };
  return json.scope ?? null;
}

export type LoginDriveResult = "linked" | "no_token" | "no_scope" | "in_use" | "error";

export async function linkDriveFromLogin(
  user: User,
  providerToken: string | null | undefined,
  providerRefreshToken: string | null | undefined,
): Promise<LoginDriveResult> {
  if (!providerToken || !providerRefreshToken) return "no_token";
  try {
    const scope = await grantedScope(providerToken);
    if (!scope?.split(" ").includes(DRIVE_FILE_SCOPE)) return "no_scope";
    const about = await getAbout(providerToken);
    if (!about.permissionId || !about.emailAddress) return "error";

    // Drive Activity의 people/{id} = 구글 계정 ID (= 로그인 identity의 sub)
    const identity = user.identities?.find((i) => i.provider === "google");
    const personId =
      (identity?.identity_data?.sub as string | undefined) ?? identity?.id ?? null;

    const admin = createAdminClient();
    const { error } = await admin.rpc("save_google_account", {
      p_user_id: user.id,
      p_google_email: about.emailAddress,
      p_permission_id: about.permissionId,
      p_display_name: about.displayName ?? null,
      p_refresh_token_enc: encryptToken(providerRefreshToken),
      p_scope: scope,
      p_person_id: personId,
    });
    if (error) return error.message === "google_account_in_use" ? "in_use" : "error";
    // 이름으로 매칭 못 했던 제안 기록 소급 (구글 문서 제안 자동 수락)
    await admin.rpc("credit_pending_suggestions", { p_user_id: user.id });
    forgetCachedToken(user.id);
    return "linked";
  } catch (e) {
    console.error("login drive link failed", e);
    return "error";
  }
}
