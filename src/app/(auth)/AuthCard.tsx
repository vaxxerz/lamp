// 로그인 · 회원가입 공통 틀: 로고 + 탭(로그인 / 회원가입) + 본문
import Link from "next/link";
import { LampLogo } from "@/components/student/ui";

export function AuthCard({
  tab,
  title,
  description,
  children,
}: {
  tab: "login" | "signup" | null;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="lamp-auth-main">
      <section className="lamp-auth-card" aria-labelledby="auth-title">
        <Link href="/login" className="lamp-auth-logo" aria-label="Lamp 로그인">
          <LampLogo />
        </Link>
        {tab && (
          <nav className="lamp-auth-tabs" aria-label="로그인 또는 회원가입">
            <Link
              href="/login"
              aria-current={tab === "login" ? "page" : undefined}
            >
              로그인
            </Link>
            <Link
              href="/signup"
              aria-current={tab === "signup" ? "page" : undefined}
            >
              회원가입
            </Link>
          </nav>
        )}
        <h1 id="auth-title">{title}</h1>
        <p className="lamp-auth-desc">{description}</p>
        {children}
      </section>
      <p className="lamp-auth-foot">
        기여의 증거는 늘 우리 곁에 있었다. 기록되지 않았을 뿐.
        <br />
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">
          개인정보처리방침
        </Link>
      </p>
    </main>
  );
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
