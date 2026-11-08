import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { googleLoginFailure } from "@/lib/google/finishLogin";
import {
  GOOGLE_LOGIN_CALLBACK,
  GOOGLE_LOGIN_COOKIE,
  GOOGLE_LOGIN_COOKIE_OPTIONS,
  googleLoginNonce,
} from "@/lib/google/loginFlow";
import { googleAuthUrl } from "@/lib/google/oauth";
import { LAMP_GOOGLE_LOGIN_ORIGIN } from "@/lib/google/scopes";
import { safeReturnTo } from "@/lib/google/session";

export function GET(req: NextRequest) {
  if (req.nextUrl.origin !== LAMP_GOOGLE_LOGIN_ORIGIN) return googleLoginFailure(req, "oauth");

  const flow = {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    next: safeReturnTo(req.nextUrl.searchParams.get("next"), "/").slice(0, 1000),
    signup: req.nextUrl.searchParams.get("signup") === "1",
  };
  const res = NextResponse.redirect(
    googleAuthUrl(flow.state, GOOGLE_LOGIN_CALLBACK, {
      nonce: googleLoginNonce(flow.nonce),
      codeChallenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    }),
  );
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(GOOGLE_LOGIN_COOKIE, JSON.stringify(flow), GOOGLE_LOGIN_COOKIE_OPTIONS);
  return res;
}
