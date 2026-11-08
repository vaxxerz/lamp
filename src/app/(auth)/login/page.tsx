import { Suspense } from "react";
import { AuthCard } from "../AuthCard";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <AuthCard
      tab="login"
      title="로그인"
      description="학생 · 교수 모두 한양대학교 구글 계정(@hanyang.ac.kr)으로 로그인해요."
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
