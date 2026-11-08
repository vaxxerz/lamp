"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LAMP_GOOGLE_LOGIN_ORIGIN, LOGIN_DRIVE_SCOPES, LOGIN_QUERY_PARAMS } from "@/lib/google/scopes";
import { GoogleIcon } from "../AuthCard";

const ERROR_MESSAGE: Record<string, string> = {
  hanyang_only:
    "한양대학교(@hanyang.ac.kr) 구글 계정으로만 로그인할 수 있어요.",
  oauth: "구글 로그인에 실패했어요. 다시 시도해 주세요.",
  demo: "데모 로그인을 사용할 수 없어요. 관리자에게 문의해 주세요.",
  signup: "가입 정보를 저장하지 못했어요. 회원가입을 다시 진행해 주세요.",
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [error, setError] = useState<string | null>(
    params.get("error")
      ? (ERROR_MESSAGE[params.get("error")!] ?? ERROR_MESSAGE.oauth)
      : null,
  );
  const [pending, setPending] = useState(false);

  async function googleLogin() {
    setPending(true);
    if (window.location.origin === LAMP_GOOGLE_LOGIN_ORIGIN) {
      const start = new URL("/auth/google", LAMP_GOOGLE_LOGIN_ORIGIN);
      start.searchParams.set("next", next);
      window.location.assign(start);
      return;
    }
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // 드라이브(선택한 파일만)도 함께 받아 로그인하자마자 문서 연동이 되게 한다
        // hd는 구글 계정 선택 화면 힌트. 실제 도메인 제한은 DB 트리거(handle_new_user)가 강제
        scopes: LOGIN_DRIVE_SCOPES,
        queryParams: LOGIN_QUERY_PARAMS,
      },
    });
    if (error) {
      setPending(false);
      setError(ERROR_MESSAGE.oauth);
    }
  }

  // 심사위원용 데모 계정 (관리자가 만든 계정만 존재)
  async function demoLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError("데모 계정 정보를 확인해 주세요.");
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="lamp-auth-body">
      <button
        className="lamp-auth-google"
        onClick={googleLogin}
        disabled={pending}
      >
        <GoogleIcon />
        한양대 구글 계정으로 로그인
      </button>
      {error && (
        <p className="lamp-auth-error" role="alert">
          {error}
        </p>
      )}
      <p className="lamp-auth-switch">
        처음이신가요? <Link href="/signup">회원가입</Link>에서 학생 · 교수를
        골라 가입해 주세요.
      </p>

      <section className="lamp-auth-demo" aria-labelledby="demo-title">
        <p id="demo-title">심사위원용 데모 체험</p>
        <form
          action="/api/demo-login"
          method="post"
          className="lamp-auth-demo-buttons"
        >
          <input type="hidden" name="next" value={next} />
          <button
            name="role"
            value="professor"
            className="lamp-button secondary"
          >
            교수로 체험
          </button>
          <button name="role" value="student" className="lamp-button secondary">
            학생으로 체험
          </button>
        </form>
        <details>
          <summary>다른 데모 계정으로 로그인</summary>
          <form onSubmit={demoLogin} className="lamp-auth-demo-form">
            <input
              name="email"
              type="email"
              required
              placeholder="student2@demo.lamp"
              className="lamp-input"
              aria-label="데모 이메일"
            />
            <input
              name="password"
              type="password"
              required
              placeholder="비밀번호"
              className="lamp-input"
              aria-label="데모 비밀번호"
            />
            <button disabled={pending} className="lamp-button">
              데모 로그인
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
