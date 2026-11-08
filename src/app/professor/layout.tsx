// 교수 워크스페이스 (실데이터) — 학생 /lamp와 같은 셸 · 디자인 시스템. 셸과 데이터는 여기서 한 번만 만든다.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfessorLoading } from "@/components/professor/ProfessorLoading";
import { ProfessorProvider } from "@/components/professor/ProfessorProvider";
import { ProfessorShell } from "@/components/professor/ProfessorShell";
import { requireRole } from "@/lib/auth";
import "../(lamp)/lamp/lamp.css";
import "../professor-demo/professor.css";

export const metadata: Metadata = {
  title: "Lamp · 교수 워크스페이스",
  description: "담당 수업의 팀 활동과 기여 근거를 살펴보는 교수 화면",
};

// 로그인한 교수만 (proxy가 로그인을, requireRole이 역할을 확인). 데이터 권한은 RLS가 다시 검사.
// 레이아웃은 메뉴를 옮겨도 다시 그려지지 않아서 확인 · 로딩은 처음 들어올 때 한 번뿐이다.
async function Guarded({ children }: { children: React.ReactNode }) {
  await requireRole("professor");
  return (
    <ProfessorProvider mode="live">
      <ProfessorShell>{children}</ProfessorShell>
    </ProfessorProvider>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        precedence="default"
      />
      <Suspense fallback={<ProfessorLoading />}>
        <Guarded>{children}</Guarded>
      </Suspense>
    </>
  );
}
