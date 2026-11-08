import { AuthCard } from "../AuthCard";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <AuthCard
      tab="signup"
      title="회원가입"
      description="학생인지 교수인지 고른 뒤 한양대학교 구글 계정으로 가입해요."
    >
      <SignupForm />
    </AuthCard>
  );
}
