// 서버 컴포넌트 · Route Handler용 Supabase 클라이언트 — 로그인 사용자 권한, RLS 적용
// Cache Components에서 이 클라이언트를 쓰는 서버 컴포넌트는 <Suspense> 안에 둔다.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

export async function createClient() {
  // 세션 만료 시각은 실제 요청에서 평가해야 한다.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서는 쿠키를 쓸 수 없음 — 세션 갱신은 proxy.ts가 담당
          }
        },
      },
    },
  );
}
