// 교수로 가입했지만 아직 교수 메일 목록에 없는 경우 — 확인을 기다리는 동안 볼 화면
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { AuthCard } from "../../AuthCard";

async function PendingStatus() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "professor") redirect("/professor");
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("professor_requests")
    .select("status, created_at")
    .eq("user_id", profile.id)
    .maybeSingle();
  const status = request?.status ?? "none";

  return (
    <div className="lamp-auth-body">
      <dl className="lamp-auth-facts">
        <div>
          <dt>계정</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt>신청 상태</dt>
          <dd>
            <span className={`lamp-auth-status is-${status}`}>
              {status === "pending"
                ? "확인 대기 중"
                : status === "rejected"
                  ? "승인되지 않음"
                  : status === "approved"
                    ? "승인됨"
                    : "신청 기록 없음"}
            </span>
          </dd>
        </div>
      </dl>
      <p className="lamp-auth-note">
        {status === "rejected"
          ? "교수 계정 신청이 승인되지 않았어요. 학과 사무실이나 관리자에게 문의해 주세요."
          : status === "none"
            ? "교수 계정 신청이 없어요. 교수라면 회원가입에서 교수를 골라 다시 가입해 주세요."
            : "학교 교수 메일 목록에 등록되면 자동으로 교수 계정이 돼요. 그동안에는 학생 화면을 쓸 수 있어요."}
      </p>
      <Link className="lamp-auth-google" href="/lamp">
        학생 화면으로 이동
      </Link>
      <p className="lamp-auth-switch">
        <LogoutButton className="lamp-auth-link" label="다른 계정으로 로그인" />
      </p>
    </div>
  );
}

export default function PendingPage() {
  return (
    <AuthCard
      tab={null}
      title="교수 계정 확인 중"
      description="가입은 끝났어요. 교수 권한만 학교 확인을 기다리고 있어요."
    >
      <Suspense fallback={<p className="lamp-auth-note">불러오는 중…</p>}>
        <PendingStatus />
      </Suspense>
    </AuthCard>
  );
}
