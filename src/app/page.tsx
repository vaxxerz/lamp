import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentProfile } from "@/lib/auth";

// 로그인 상태면 역할별 홈으로 이동 (로그인 안 됐으면 proxy가 /login 으로 보냄)
async function RedirectIfLoggedIn() {
  const profile = await getCurrentProfile();
  // 학생은 새 워크스페이스(/lamp), 교수는 교수 화면
  if (profile) redirect(profile.role === "professor" ? "/professor" : "/lamp");
  return null;
}

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <Suspense fallback={null}>
        <RedirectIfLoggedIn />
      </Suspense>
      <h1 className="text-4xl font-bold">Lamp.</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        기여의 증거는 늘 우리 곁에 있었다. 기록되지 않았을 뿐.
      </p>
      {/* TODO(C): 랜딩 — 문제 정의 · 기능 소개 · 데모 계정 안내 */}
      <Link
        href="/login"
        className="rounded-lg bg-zinc-900 px-5 py-2.5 text-white dark:bg-white dark:text-zinc-900"
      >
        한양대 구글 계정으로 시작하기
      </Link>
    </main>
  );
}
