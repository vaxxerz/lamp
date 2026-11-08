import type { Metadata } from "next";
import { StudentShell } from "@/components/student/StudentShell";
import { StudentGate, StudentProvider } from "@/components/student/StudentProvider";
import "./lamp.css";
export const metadata: Metadata = {
  title: "Lamp · 학생 워크스페이스",
  description: "함께 쌓아가는 우리 팀의 기여 기록",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <StudentProvider>
      {/* Pretendard (한글 본문 가독성) — React 19가 <head>로 올려 준다 */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        precedence="default"
      />

      <StudentShell>
        <StudentGate>{children}</StudentGate>
      </StudentShell>
    </StudentProvider>
  );
}
