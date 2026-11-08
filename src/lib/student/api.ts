import {
  documents,
  meetings,
  team,
  users,
  currentUser,
} from "./mock-data";
import type {
  ConnectedDocument,
  Meeting,
  AttendanceStatus,
} from "./types";
const KEY = "lamp-student-demo-v1";
export interface StudentData {
  documents: ConnectedDocument[];
  meetings: Meeting[];
}
export function parseGoogleUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("올바른 Google Docs 또는 Slides URL을 입력해 주세요.");
  }
  const match = url.pathname.match(
    /^\/(document|presentation)\/d\/([A-Za-z0-9_-]+)(?:\/|$)/,
  );
  if (
    url.protocol !== "https:" ||
    !["docs.google.com", "slides.google.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !match ||
    (url.hostname === "slides.google.com" && match[1] !== "presentation")
  )
    throw new Error(
      "https://docs.google.com/document/d/… 또는 /presentation/d/… 형식의 링크를 입력해 주세요.",
    );
  return {
    type: match[1] === "document" ? ("docs" as const) : ("slides" as const),
    sourceUrl: `https://docs.google.com/${match[1]}/d/${match[2]}/edit`,
  };
}
// Replace these async methods with authenticated backend calls when integration is ready.
export const studentApi = {
  async load(): Promise<StudentData> {
    const saved = localStorage.getItem(KEY);
    if (!saved) return structuredClone({ documents, meetings });
    try {
      const data = JSON.parse(saved) as StudentData;
      if (!Array.isArray(data.documents) || !Array.isArray(data.meetings))
        throw new Error();
      for (const d of data.documents) {
        if (
          typeof d.id !== "string" ||
          typeof d.name !== "string" ||
          !["docs", "slides"].includes(d.type) ||
          !Number.isFinite(d.changeCount) ||
          (d.updatedAt !== null && !Number.isFinite(Date.parse(d.updatedAt)))
        )
          throw new Error();
        parseGoogleUrl(d.sourceUrl);
      }
      for (const m of data.meetings)
        if (
          typeof m.id !== "string" ||
          typeof m.notes !== "string" ||
          typeof m.title !== "string" ||
          typeof m.location !== "string" ||
          !Number.isFinite(Date.parse(m.heldAt)) ||
          !m.attendance ||
          users.some(
            (u) =>
              !["unchecked", "present", "late", "absent", "excused"].includes(
                m.attendance[u.id],
              ),
          )
        )
          throw new Error();
      return data;
    } catch {
      throw new Error(
        "저장된 데모 데이터를 읽을 수 없습니다. 데모 데이터를 초기화해 주세요.",
      );
    }
  },
  async save(data: StudentData) {
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  },
  async reset() {
    localStorage.removeItem(KEY);
    return structuredClone({ documents, meetings });
  },
  async connectDocument(data: StudentData, input: string, name: string) {
    const parsed = parseGoogleUrl(input);
    if (data.documents.some((d) => d.sourceUrl === parsed.sourceUrl))
      throw new Error("이미 추가한 문서입니다.");
    const doc: ConnectedDocument = {
      id: crypto.randomUUID(),
      teamId: team.id,
      name:
        name.trim() ||
        (parsed.type === "docs" ? "새 Google 문서" : "새 Google 발표자료"),
      ...parsed,
      updatedAt: null,
      changeCount: 0,
    };
    return this.save({ ...data, documents: [...data.documents, doc] });
  },
  async saveMeeting(data: StudentData, meeting: Meeting) {
    const existing = data.meetings.find((m) => m.id === meeting.id);
    if (
      meeting.attendance[currentUser.id] !==
      (existing?.attendance[currentUser.id] ?? "unchecked")
    ) {
      throw new Error("본인의 출석 상태는 다른 팀원만 변경할 수 있습니다.");
    }
    const next = data.meetings.some((m) => m.id === meeting.id)
      ? data.meetings.map((m) => (m.id === meeting.id ? meeting : m))
      : [...data.meetings, meeting];
    return this.save({ ...data, meetings: next });
  },
  async setAttendance(
    data: StudentData,
    meetingId: string,
    userId: string,
    status: AttendanceStatus,
  ) {
    if (userId === currentUser.id)
      throw new Error("본인의 출석은 다른 팀원이 확인해야 합니다.");
    if (!team.members.some((m) => m.userId === userId))
      throw new Error("팀원이 아닙니다.");
    const meeting = data.meetings.find((m) => m.id === meetingId);
    if (!meeting) throw new Error("회의를 찾을 수 없습니다.");
    return this.saveMeeting(data, {
      ...meeting,
      attendance: { ...meeting.attendance, [userId]: status },
    });
  },
};
