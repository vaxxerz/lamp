// GET /api/google/connect?returnTo=/student/teams/...  → 구글 동의 화면으로 이동
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl, googleRedirectUri } from "@/lib/google/oauth";
import { currentUserId, safeReturnTo } from "@/lib/google/session";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  if (!(await currentUserId())) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(returnTo)}`, req.url));
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(state, googleRedirectUri(req.nextUrl.origin)));
  res.cookies.set("g_oauth", JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
