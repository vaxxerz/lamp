// 서버 전용: 구글 OAuth
// drive.file: 사용자가 Picker로 고른 파일만 접근
// drive.activity.readonly: 구간별 실제 편집자 조회 (Drive Activity API) — 없으면 lastModifyingUser로 대체
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "./crypto";
import { LOGIN_QUERY_PARAMS } from "./scopes";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_ACTIVITY_SCOPE = "https://www.googleapis.com/auth/drive.activity.readonly";
const SCOPES = ["openid", "email", "profile", DRIVE_FILE_SCOPE, DRIVE_ACTIVITY_SCOPE];
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function clientCreds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not set");
  return { id, secret };
}

export function googleRedirectUri(origin: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || origin;
  return new URL("/api/google/callback", siteUrl).href;
}

export function googleAuthUrl(
  state: string,
  redirectUri: string,
  login?: { readonly nonce: string; readonly codeChallenge: string },
) {
  const params = new URLSearchParams({
    client_id: clientCreds().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // refresh token 발급
    prompt: "consent", // 재연결 시에도 refresh token 다시 받기
    include_granted_scopes: "true",
    state,
    ...(login && {
      ...LOGIN_QUERY_PARAMS,
      nonce: login.nonce,
      code_challenge: login.codeChallenge,
      code_challenge_method: "S256",
    }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
};

/** 토큰 엔드포인트에서 직접 받은 id_token의 sub (= 구글 계정 ID, Activity API의 people/{id}) */
export function idTokenSubject(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const sub = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`google_token_error:${json.error ?? res.status}`);
  return json as TokenResponse;
}

export function exchangeCode(code: string, redirectUri: string, codeVerifier?: string) {
  return tokenRequest({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    ...(codeVerifier && { code_verifier: codeVerifier }),
  });
}

// 서버리스 인스턴스 안에서만 유효한 짧은 캐시
const cache = new Map<string, { token: string; expiresAt: number }>();

/** 사용자의 구글 access token (연결 안 됐거나 토큰이 취소됐으면 null) */
export async function getUserAccessToken(admin: SupabaseClient, userId: string): Promise<string | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const { data } = await admin
    .from("google_accounts")
    .select("refresh_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;

  try {
    const t = await tokenRequest({
      refresh_token: decryptToken(data.refresh_token_enc),
      grant_type: "refresh_token",
    });
    cache.set(userId, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (String(e).includes("invalid_grant")) return null; // 사용자가 구글에서 권한 취소
    throw e;
  }
}

export async function revokeGoogleToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch(() => undefined);
}

export function forgetCachedToken(userId: string) {
  cache.delete(userId);
}
