import type { ProfessorData } from "./types";
export const professorMock: ProfessorData = {
  professor: { id: "p1", name: "김교수", role: "professor" },
  courses: [
    {
      id: "c1",
      name: "소프트웨어공학",
      professorId: "p1",
      inviteCode: "COURSE-SE26",
    },
    {
      id: "c2",
      name: "데이터 사이언스",
      professorId: "p1",
      inviteCode: "COURSE-DS26",
    },
  ],
  users: ["김지민", "박서연", "이도윤", "최유진", "정하늘", "한수빈"].map(
    (name, i) => ({
      id: `u${i + 1}`,
      name,
      email: `demo${i + 1}@example.invalid`,
    }),
  ),
  teams: [
    {
      id: "t1",
      courseId: "c1",
      name: "등잔 팀",
      createdBy: "student",
      inviteCode: "TEAM-LAMP26",
      members: [
        { userId: "u1", role: "leader" },
        { userId: "u2", role: "member" },
        { userId: "u3", role: "member" },
      ],
    },
    {
      id: "t2",
      courseId: "c1",
      name: "보라 팀",
      createdBy: "professor",
      inviteCode: "TEAM-VIOLET",
      members: [
        { userId: "u4", role: "leader" },
        { userId: "u5", role: "member" },
      ],
    },
    {
      id: "t3",
      courseId: "c2",
      name: "데이터 랩",
      createdBy: "student",
      inviteCode: "TEAM-DATA26",
      members: [{ userId: "u6", role: "leader" }],
    },
  ],
  documents: [
    {
      id: "d1",
      teamId: "t1",
      name: "서비스 기획서",
      type: "docs",
      sourceUrl: "",
      updatedAt: "2026-11-07T06:30:00Z",
      changeCount: 12,
    },
    {
      id: "d2",
      teamId: "t1",
      name: "중간 발표",
      type: "slides",
      sourceUrl: "",
      updatedAt: "2026-11-06T08:00:00Z",
      changeCount: 2,
    },
    {
      id: "d3",
      teamId: "t2",
      name: "사용자 인터뷰",
      type: "docs",
      sourceUrl: "",
      updatedAt: "2026-11-05T02:00:00Z",
      changeCount: 2,
    },
  ],
  activities: Array.from({ length: 16 }, (_, i) => ({
    id: `pa${i + 1}`,
    teamId: i < 14 ? "t1" : "t2",
    documentId: i < 12 ? "d1" : i < 14 ? "d2" : "d3",
    userId: i % 5 === 4 ? null : i < 14 ? `u${(i % 3) + 1}` : "u4",
    title: ["서비스 목표 추가", "사용자 흐름 구체화", "중복 내용 삭제"][i % 3],
    actionType: (["add", "edit", "delete"] as const)[i % 3],
    contentBefore:
      i % 3 === 0
        ? null
        : "팀 프로젝트의 활동을 기록합니다. 기존 초안에서 검토한 사용자 요구사항입니다.",
    contentAfter:
      i % 3 === 2
        ? null
        : "문서의 수정 이력과 회의 기록을 함께 확인합니다. 작성자가 확인된 기록을 근거로 작업 내용을 설명하고, 추정과 미확인 내역은 구분하여 보관합니다.",
    timestamp: new Date(Date.UTC(2026, 10, 7, 6, 30 - i * 30)).toISOString(),
    attributionStatus:
      i % 5 === 4 ? "unknown" : i % 5 === 3 ? "inferred" : "verified",
    sourceUrl: "",
  })),
  meetings: [
    {
      id: "pm1",
      teamId: "t1",
      title: "중간 발표 준비",
      heldAt: "2026-11-07T05:00:00Z",
      location: "학술정보관 스터디룸 2",
      notes:
        "서비스 기획서 검토\n지민: 사용자 흐름 정리\n서연: 발표 자료 준비\n다음 회의에서 프로토타입을 함께 검토합니다.",
      attendance: { u1: "present", u2: "late", u3: "excused" },
      confirmations: {
        u1: { userId: "u2", at: "2026-11-07T05:05:00Z" },
        u2: { userId: "u1", at: "2026-11-07T05:15:00Z" },
      },
    },
    {
      id: "pm2",
      teamId: "t2",
      title: "인터뷰 회고",
      heldAt: "2026-11-06T02:00:00Z",
      location: "온라인",
      notes: "인터뷰 결과를 분류하고 다음 작업을 논의했습니다.",
      attendance: { u4: "unchecked", u5: "absent" },
      confirmations: {},
    },
  ],
};
