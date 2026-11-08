import { redirect } from "next/navigation";

// AI 보고서 탭은 기여 분석 탭으로 합쳤다 — 예전 주소는 그쪽으로 보낸다
export default function Page() {
  redirect("/lamp/analysis");
}
