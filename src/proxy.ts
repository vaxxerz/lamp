// Next.js 16: middleware → proxy
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // 교수 화면의 공개 데모
  if (
    request.nextUrl.pathname === "/professor-demo" ||
    request.nextUrl.pathname.startsWith("/professor-demo/")
  ) {
    const { NextResponse } = await import("next/server");
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/lamp/:path*",
    // 정적 파일 · 이미지 · API 제외 (API는 Route Handler에서 직접 인증 확인)
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
