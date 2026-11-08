import type { NextRequest, NextResponse } from "next/server";
import { finishGoogleLogin, googleLoginFailure } from "@/lib/google/finishLogin";
import {
  GOOGLE_LOGIN_CALLBACK,
  GOOGLE_LOGIN_COOKIE,
  GOOGLE_LOGIN_COOKIE_OPTIONS,
  googleLoginNonce,
  parseGoogleLoginFlow,
  readGoogleLoginClaims,
} from "@/lib/google/loginFlow";
import { exchangeCode } from "@/lib/google/oauth";
import { LAMP_GOOGLE_LOGIN_ORIGIN } from "@/lib/google/scopes";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const flow = parseGoogleLoginFlow(req.cookies.get(GOOGLE_LOGIN_COOKIE)?.value);
  if (req.nextUrl.origin !== LAMP_GOOGLE_LOGIN_ORIGIN || !flow || params.get("state") !== flow.state) {
    return googleLoginFailure(req, "oauth");
  }

  const done = (res: NextResponse) => {
    res.headers.set("Cache-Control", "no-store");
    res.cookies.set(GOOGLE_LOGIN_COOKIE, "", { ...GOOGLE_LOGIN_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  };
  const code = params.get("code");
  if (params.has("error") || !code) return done(googleLoginFailure(req, "oauth"));

  try {
    const tokens = await exchangeCode(code, GOOGLE_LOGIN_CALLBACK, flow.verifier);
    if (!tokens.id_token) return done(googleLoginFailure(req, "oauth"));
    const claims = readGoogleLoginClaims(tokens.id_token);
    if (!claims || claims.nonce !== googleLoginNonce(flow.nonce)) {
      return done(googleLoginFailure(req, "oauth"));
    }
    if (!claims.email_verified || !claims.email.toLowerCase().endsWith("@hanyang.ac.kr")) {
      return done(googleLoginFailure(req, "hanyang_only"));
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: tokens.id_token,
      access_token: tokens.access_token,
      nonce: flow.nonce,
    });
    if (error || !data.user) return done(googleLoginFailure(req, "oauth"));

    return done(await finishGoogleLogin(req, supabase, data.user, {
      next: flow.next,
      signup: flow.signup,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    }));
  } catch {
    return done(googleLoginFailure(req, "oauth"));
  }
}
