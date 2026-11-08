"use client";
// /lamp 작업 공간 상태
//  로그인 + 팀 있음 → 실데이터 (Supabase, 제안 · revision · 회의 변경을 Realtime으로 받아 자동 갱신)
//  팀 없는 계정 → 팀 시작 화면 / 비로그인 → Mock 데모
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { watchWorkspaceChanges } from "@/lib/workspace-refresh";
import { studentApi, type StudentData } from "@/lib/student/api";
import { createLiveMeeting, loadLiveWorkspace, saveLiveNotes, setLiveAttendance } from "@/lib/student/live";
import { Onboarding } from "./Onboarding";
import { activities, currentUser, documents, meetings, team, users } from "@/lib/student/mock-data";
import type { AttendanceStatus, Meeting, Workspace } from "@/lib/student/types";

type Ctx = {
  ws: Workspace;
  ready: boolean;
  error: string;
  /** 로그인했지만 팀이 없음 → 과목 · 팀 참여 화면 */
  noTeam: { userId: string; name: string } | null;
  supabase: SupabaseClient;
  /** 실데이터 쓰기 실행 후 다시 불러오기 */
  act: (fn: () => Promise<unknown>) => Promise<void>;
  /** 팀 전환 (독립 팀플 · 과목 팀플을 오갈 때) */
  selectTeam: (teamId: string) => Promise<void>;
  reload: () => Promise<void>;
  resetMock: () => Promise<void>;
  connectDocument: (url: string, name: string) => Promise<void>;
  createMeeting: (input: { title: string; heldAt: string; location: string }) => Promise<string>;
  setAttendance: (meetingId: string, userId: string, status: AttendanceStatus) => Promise<void>;
  saveNotes: (meetingId: string, notes: string) => Promise<void>;
};

const Context = createContext<Ctx | null>(null);

// 고른 팀은 이 브라우저에만 기억 (편의 기능 — 없거나 막혀도 최근 팀으로 열림)
const TEAM_KEY = "lamp-team-id";
const readTeam = () => {
  try {
    return localStorage.getItem(TEAM_KEY);
  } catch {
    return null;
  }
};
const writeTeam = (id: string) => {
  try {
    localStorage.setItem(TEAM_KEY, id);
  } catch {}
};

const mockWorkspace = (data: StudentData): Workspace => ({
  mode: "mock",
  me: currentUser,
  team,
  teams: [],
  users,
  documents: data.documents,
  activities,
  meetings: data.meetings,
  tasks: [],
  files: [],
  events: [],
  scores: [],
});

export function StudentProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(createClient);
  const [ws, setWs] = useState<Workspace>(() => mockWorkspace(structuredClone({ documents, meetings })));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [noTeam, setNoTeam] = useState<Ctx["noTeam"]>(null);
  const mockData = useRef<StudentData>({ documents, meetings });
  const loadVersion = useRef(0);

  const reload = useCallback(async (background = false) => {
    const request = ++loadVersion.current;
    if (!background) setError("");
    try {
      const live = await loadLiveWorkspace(supabase, readTeam());
      if (request !== loadVersion.current) return;
      setError("");
      setNoTeam(live.status === "no-team" ? { userId: live.userId, name: live.name } : null);
      if (live.status === "ok") {
        setWs(live.ws);
      } else if (live.status === "signed-out") {
        mockData.current = await studentApi.load();
        setWs(mockWorkspace(mockData.current));
      }
    } catch (e) {
      // Keep mounted editors intact during a temporary background refresh failure.
      if (!background && request === loadVersion.current)
        setError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.");
    } finally {
      if (request === loadVersion.current) setReady(true);
    }
  }, [supabase]);

  useEffect(() => {
    const invalidate = () => { loadVersion.current++; };
    // 마운트 직후 1회 로드 (상태 갱신은 비동기 콜백 안에서만 일어남)
    let active = true;
    void (async () => {
      if (active) await reload();
    })();
    return () => {
      active = false;
      invalidate();
    };
  }, [reload]);

  // Team membership is observed even before the user has joined their first team.
  const live = ws.mode === "live" || noTeam !== null;
  useEffect(() => {
    if (live) return watchWorkspaceChanges(supabase, () => reload(true));
  }, [supabase, live, reload]);

  const mockUpdate = async (op: (d: StudentData) => Promise<StudentData>) => {
    mockData.current = await op(mockData.current);
    setWs(mockWorkspace(mockData.current));
  };
  const findMeeting = (id: string): Meeting => {
    const m = ws.meetings.find((x) => x.id === id);
    if (!m) throw new Error("회의를 찾을 수 없습니다.");
    return m;
  };

  const value: Ctx = {
    ws,
    ready,
    error,
    noTeam,
    supabase,
    act: async (fn) => {
      await fn();
      await reload();
    },
    selectTeam: async (teamId) => {
      writeTeam(teamId);
      await reload();
    },
    reload,
    resetMock: async () => {
      mockData.current = await studentApi.reset();
      setWs(mockWorkspace(mockData.current));
      setError("");
    },
    connectDocument: (url, name) => mockUpdate((d) => studentApi.connectDocument(d, url, name)),
    createMeeting: async (input) => {
      if (ws.mode === "live") {
        const id = await createLiveMeeting(supabase, ws.team.id, input);
        await reload();
        return id;
      }
      const meeting: Meeting = {
        id: crypto.randomUUID(),
        teamId: ws.team.id,
        ...input,
        notes: "",
        attendance: Object.fromEntries(ws.users.map((u) => [u.id, "unchecked"])),
      };
      await mockUpdate((d) => studentApi.saveMeeting(d, meeting));
      return meeting.id;
    },
    setAttendance: async (meetingId, userId, status) => {
      if (ws.mode === "live") {
        await setLiveAttendance(supabase, meetingId, userId, status);
        return reload();
      }
      await mockUpdate((d) => studentApi.setAttendance(d, meetingId, userId, status));
    },
    saveNotes: async (meetingId, notes) => {
      if (ws.mode === "live") {
        await saveLiveNotes(findMeeting(meetingId), notes);
        return reload();
      }
      await mockUpdate((d) => {
        const latest = d.meetings.find((m) => m.id === meetingId)!;
        return studentApi.saveMeeting(d, { ...latest, notes });
      });
    },
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** 페이지 본문: 로딩 · 오류 처리 */
export function StudentGate({ children }: { children: ReactNode }) {
  const { ready, error, reload, resetMock, ws, noTeam } = useStudent();
  if (error)
    return (
      <section className="lamp-empty" role="alert">
        <h2>데이터를 불러오지 못했어요</h2>
        <p>{error}</p>
        <button className="lamp-button" onClick={() => void reload()}>
          다시 시도
        </button>{" "}
        {ws.mode === "mock" && (
          <button className="lamp-button secondary" onClick={() => void resetMock()}>
            데모 데이터 초기화
          </button>
        )}
      </section>
    );
  if (ready && noTeam) return <Onboarding />;
  if (!ready)
    return (
      <div className="lamp-loading" role="status">
        <span className="lamp-spinner" />
        워크스페이스를 준비하고 있어요…
      </div>
    );
  return <>{children}</>;
}

/** StudentProvider 밖(교수 화면 등)에서도 쓸 수 있는 버전 — 없으면 null */
export function useStudentOptional() {
  return useContext(Context);
}
export function useStudent() {
  const value = useContext(Context);
  if (!value) throw new Error("StudentProvider is required");
  return value;
}
