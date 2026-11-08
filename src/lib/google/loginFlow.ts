import { createHash } from "node:crypto";
import { z } from "zod";
import { LAMP_GOOGLE_LOGIN_ORIGIN } from "./scopes";

export const GOOGLE_LOGIN_CALLBACK = `${LAMP_GOOGLE_LOGIN_ORIGIN}/auth/google/callback`;
export const GOOGLE_LOGIN_COOKIE = "__Host-lamp-google-login";
export const GOOGLE_LOGIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 600,
} as const;

const flowSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  next: z.string().max(1000),
  signup: z.boolean(),
});

export function parseGoogleLoginFlow(raw: string | undefined) {
  if (!raw) return null;
  try {
    const result = flowSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function googleLoginNonce(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}

const googleClaimsSchema = z.object({
  email: z.string(),
  email_verified: z.boolean(),
  nonce: z.string(),
});

// Supabase verifies the Google-issued token before creating the app session.
export function readGoogleLoginClaims(token: string) {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const result = googleClaimsSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
