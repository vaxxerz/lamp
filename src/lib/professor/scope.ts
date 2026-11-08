import type { ProfessorData } from "./types";
export class ProfessorAccessError extends Error {}
// Replace with authenticated server endpoints. Client scoping is NOT authorization.
export function scopeProfessorData(data: ProfessorData): ProfessorData {
  if (data.professor.role !== "professor")
    throw new ProfessorAccessError("교수 권한이 없습니다.");
  const courses = data.courses.filter(
    (c) => c.professorId === data.professor.id,
  );
  const teams = data.teams.filter((t) =>
    courses.some((c) => c.id === t.courseId),
  );
  const documents = data.documents.filter((d) =>
    teams.some((t) => t.id === d.teamId),
  );
  return {
    ...data,
    courses,
    teams,
    users: data.users.filter((u) =>
      teams.some((t) => t.members.some((m) => m.userId === u.id)),
    ),
    documents,
    activities: data.activities.filter(
      (a) =>
        teams.some((t) => t.id === a.teamId) &&
        documents.some((d) => d.id === a.documentId && d.teamId === a.teamId),
    ),
    meetings: data.meetings.filter((m) => teams.some((t) => t.id === m.teamId)),
    events: data.events?.filter((event) => teams.some((team) => team.id === event.teamId)),
  };
}
