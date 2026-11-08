"use client";
// 교수 화면 라우팅 (공개 예시 /professor-demo, 실데이터 /professor 공용) — 셸은 레이아웃에 있고 여기는 본문만 고른다
//  /                         모든 수업 홈
//  /dashboard?course=…       수업 하나의 대시보드 (과목 없으면 전체 대시보드)
//  /courses                  과목·팀 관리
//  /teams/[teamId]/[section] 팀 화면 — 팀원 분석(AI 분석 포함) · 문서 · 기록 · 회의록 (읽기 전용)
//  /teams/[teamId]/documents/[docId] 문서 하나의 분석 (학생 문서 분석과 같은 화면)
//  예전 수업 단위 주소(/analysis · /activities · /reports · /meetings)와 팀 /reports(→ /analysis)는 page.tsx가 옮겨 준다
// 주소는 훅이 아니라 page.tsx가 넘겨준 값으로 읽는다. Cache Components는 이전 화면을 숨긴 채 남겨 두는데,
// 훅으로 읽으면 숨은 화면도 현재 주소로 다시 그려져 같은 내용이 두 벌 생긴다.
import { notFound } from "next/navigation";
import { ProfessorGate } from "./ProfessorProvider";
import { ProfessorTeamWorkspace } from "./ProfessorTeamWorkspace";
import { ProfessorWorkspace } from "./ProfessorWorkspace";

const TEAM_SECTIONS = [
  "dashboard",
  "analysis",
  "documents",
  "activities",
  "meetings",
];
// 수업 단위는 홈 · 팀별 지표 대시보드 · 관리만 (분석 · 기록 · 회의록은 팀 화면)
const SECTIONS = ["home", "dashboard", "courses"];

export function ProfessorView({
  view,
  search,
}: {
  view: string[];
  search: Record<string, string>;
}) {
  const query = new URLSearchParams(search);
  if (view[0] === "teams") {
    const teamId = view[1];
    const section = view[2] ?? "dashboard";
    // 문서 분석만 한 단계 더: /teams/[teamId]/documents/[docId]
    const docId = section === "documents" ? view[3] : undefined;
    if (
      !teamId ||
      view.length > (docId ? 4 : 3) ||
      !TEAM_SECTIONS.includes(section)
    )
      notFound();
    const recordId = query.get("record") ?? undefined;
    const student = query.get("student") ?? undefined;
    const doc = query.get("doc") ?? undefined;
    return (
      <ProfessorGate>
        <ProfessorTeamWorkspace
          key={`${teamId}:${section}:${docId ?? ""}:${recordId ?? ""}:${student ?? ""}:${doc ?? ""}`}
          docId={docId}
          documentFilter={doc}
          recordId={recordId}
          studentId={student}
          teamId={teamId}
          view={section}
        />
      </ProfessorGate>
    );
  }
  const section = view[0] ?? "home";
  if (view.length > 1 || !SECTIONS.includes(section)) notFound();
  return (
    <ProfessorGate>
      <ProfessorWorkspace
        key={section + query.toString()}
        view={section}
        query={query}
      />
    </ProfessorGate>
  );
}
