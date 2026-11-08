// Supabase PKCE callback for alternate hosts and sign-ins already in progress.
import type { NextRequest } from "next/server";
import { finishGoogleLogin, googleLoginFailure } from "@/lib/google/finishLogin";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.has("error")) {
    const description = params.get("error_description") ?? "";
    return googleLoginFailure(req, /database error|hanyang/i.test(description) ? "hanyang_only" : "oauth");
  }

  const code = params.get("code");
  if (!code) return googleLoginFailure(req, "oauth");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return googleLoginFailure(req, "oauth");

  return finishGoogleLogin(req, supabase, data.user, {
    next: params.get("next"),
    signup: params.get("signup") === "1",
    accessToken: data.session?.provider_token,
    refreshToken: data.session?.provider_refresh_token,
  });
}
