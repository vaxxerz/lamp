// POST /api/demo-login (form: role=professor|student) — 심사위원용 원클릭 데모 로그인
// 비밀번호는 서버 환경변수(DEMO_PASSWORD)에만 있고 브라우저로 나가지 않음. 미설정 시 비활성.
import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/google/session";
import { createClient } from "@/lib/supabase/server";

const DEMO_ACCOUNTS: Record<string, { email: string; home: string }> = {
  professor: { email: "professor@demo.lamp", home: "/professor" },
  student: { email: "student1@demo.lamp", home: "/lamp" },
};

export async function POST(req: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  const form = await req.formData();
  const role = String(form.get("role") ?? "");
  const next = form.get("next");
  const account = DEMO_ACCOUNTS[role];
  if (!password || !account) {
    return NextResponse.redirect(new URL("/login?error=demo", req.url), 303);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  if (error) return NextResponse.redirect(new URL("/login?error=demo", req.url), 303);
  // 로그인 화면에 next가 있으면 그리로 (예: /lamp/documents), 없거나 다른 역할의 화면이면 역할별 홈
  const otherHomes = Object.values(DEMO_ACCOUNTS)
    .map((a) => a.home)
    .filter((home) => home !== account.home);
  const allowed =
    typeof next === "string" &&
    next !== "/" &&
    !otherHomes.some((home) => next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`));
  const target = allowed ? safeReturnTo(next, account.home) : account.home;
  return NextResponse.redirect(new URL(target, req.url), 303);
}
