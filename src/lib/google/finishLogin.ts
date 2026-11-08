import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { homeAfterSignup, parseSignupIntent, SIGNUP_COOKIE } from "@/lib/signup";
import type { createClient } from "@/lib/supabase/server";
import { linkDriveFromLogin } from "./loginLink";
import { safeReturnTo } from "./session";

export function googleLoginFailure(req: NextRequest, reason: "hanyang_only" | "oauth" | "signup") {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, req.url));
}

export async function finishGoogleLogin(
  req: NextRequest,
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User,
  options: {
    readonly next: string | null;
    readonly signup: boolean;
    readonly accessToken?: string | null;
    readonly refreshToken?: string | null;
  },
) {
  if (!user.email?.toLowerCase().endsWith("@hanyang.ac.kr")) {
    await supabase.auth.signOut();
    return googleLoginFailure(req, "hanyang_only");
  }

  await linkDriveFromLogin(user, options.accessToken, options.refreshToken);

  if (options.signup) {
    const intent = parseSignupIntent(req.cookies.get(SIGNUP_COOKIE)?.value);
    if (!intent) return googleLoginFailure(req, "signup");
    const { data: result, error } = await supabase.rpc("complete_signup", {
      p_role: intent.role,
      p_student_no: intent.studentNo || null,
      p_department: intent.department || null,
    });
    if (error || typeof result !== "string") return googleLoginFailure(req, "signup");

    const res = NextResponse.redirect(new URL(homeAfterSignup(result), req.url));
    res.cookies.delete(SIGNUP_COOKIE);
    return res;
  }

  const next = new URL(safeReturnTo(options.next, "/"), req.url);
  return NextResponse.redirect(next.origin === req.nextUrl.origin ? next : new URL("/", req.url));
}
