// 요청마다 Supabase 세션 쿠키를 갱신하고, 보호된 경로는 로그인으로 보냄
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/lamp", "/student", "/professor"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;

  if (path === "/login" && data?.claims?.sub) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.claims.sub)
      .maybeSingle();
    if (profile?.role === "student" || profile?.role === "professor") {
      const home = profile.role === "professor" ? "/professor" : "/lamp";
      const redirect = NextResponse.redirect(new URL(home, request.url));
      redirect.headers.set("Cache-Control", "private, no-store");
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  }

  // 예전 학생 홈(/student)은 새 학생 워크스페이스(/lamp)로
  if (path === "/student") {
    const url = request.nextUrl.clone();
    url.pathname = "/lamp";
    return NextResponse.redirect(url);
  }
  // 로그인 안 된 채 첫 화면(/)에 오면 바로 로그인 · 회원가입으로
  if (!data?.claims && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (!data?.claims && PROTECTED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return response;
}
