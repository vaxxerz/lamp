import { redirect } from "next/navigation";
import { ProfessorView } from "@/components/professor/ProfessorView";

// 예전 수업 단위 화면 → 팀 화면 (팀을 알면) 또는 수업 대시보드
const LEGACY = ["analysis", "activities", "reports", "meetings"];

// 본문만 고른다. 셸 · 데이터 · 권한 확인은 layout.tsx
export default async function Page({
  params,
  searchParams,
}: PageProps<"/professor-demo/[[...view]]">) {
  const { view = [] } = await params;
  const search = Object.fromEntries(
    Object.entries(await searchParams).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : [],
    ),
  );
  // AI 보고서 탭은 팀원 분석 탭으로 합쳤다
  if (view.length === 3 && view[0] === "teams" && view[2] === "reports")
    redirect(`/professor-demo/teams/${encodeURIComponent(view[1])}/analysis`);
  if (view.length === 1 && LEGACY.includes(view[0])) {
    const section = view[0] === "reports" ? "analysis" : view[0];
    const q = new URLSearchParams();
    if (search.record) q.set("record", search.record);
    if (search.team)
      redirect(
        `/professor-demo/teams/${encodeURIComponent(search.team)}/${section}${q.size ? `?${q}` : ""}`,
      );
    redirect(
      `/professor-demo/dashboard${search.course ? `?course=${encodeURIComponent(search.course)}` : ""}`,
    );
  }
  return <ProfessorView view={view} search={search} />;
}
