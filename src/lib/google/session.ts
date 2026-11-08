// Route Handler 공통: 로그인 사용자 id
import { createClient } from "@/lib/supabase/server";

export async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

/** 오픈 리다이렉트 방지: 같은 사이트 내 경로만 */
export function safeReturnTo(value: string | null | undefined, fallback = "/lamp") {
  // "/\evil.com"은 브라우저가 "//evil.com"으로 해석하므로 역슬래시도 막는다
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}
