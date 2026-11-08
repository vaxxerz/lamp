import { professorMock } from "./mock-data";
import type { ProfessorData, ProfessorTeam } from "./types";
const KEY = "lamp-professor-teams-v1";
import { scopeProfessorData } from "./scope";
export { ProfessorAccessError } from "./scope";
export const professorApi = {
  async load(): Promise<ProfessorData> {
    const data = structuredClone(professorMock);
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const teams: unknown = JSON.parse(raw);
      if (
        !Array.isArray(teams) ||
        !teams.every(
          (t) =>
            t &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            t.name.trim() &&
            typeof t.inviteCode === "string" &&
            ["student", "professor"].includes(t.createdBy) &&
            data.courses.some((c) => c.id === t.courseId) &&
            Array.isArray(t.members) &&
            t.members.every(
              (m: { userId: string; role: string }) =>
                m &&
                data.users.some((u) => u.id === m.userId) &&
                ["leader", "member"].includes(m.role),
            ),
        ) ||
        new Set(teams.map((t) => t.id)).size !== teams.length
      )
        throw new Error(
          "저장된 Mock 팀 데이터를 읽을 수 없습니다. 데모 팀을 초기화해 주세요.",
        );
      data.teams = teams;
    }
    return scopeProfessorData(data);
  },
  async saveTeams(teams: ProfessorTeam[]) {
    localStorage.setItem(KEY, JSON.stringify(teams));
  },
  async reset() {
    localStorage.removeItem(KEY);
  },
};
