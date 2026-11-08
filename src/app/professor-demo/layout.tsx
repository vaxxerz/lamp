// 교수 공개 예시 (Mock) — 학생 /lamp와 같은 셸 · 디자인 시스템. 셸과 데이터는 여기서 한 번만 만든다.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfessorLoading } from "@/components/professor/ProfessorLoading";
import { ProfessorProvider } from "@/components/professor/ProfessorProvider";
import { ProfessorShell } from "@/components/professor/ProfessorShell";
import "../(lamp)/lamp/lamp.css";
import "./professor.css";

export const metadata: Metadata = {
  title: "Lamp · 교수 워크스페이스 (Mock)",
  description: "담당 과목의 팀 활동과 기여 근거를 살펴보는 교수용 Mock 화면",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        precedence="default"
      />
      <Suspense fallback={<ProfessorLoading />}>
        <ProfessorProvider mode="mock">
          <ProfessorShell>{children}</ProfessorShell>
        </ProfessorProvider>
      </Suspense>
    </>
  );
}
