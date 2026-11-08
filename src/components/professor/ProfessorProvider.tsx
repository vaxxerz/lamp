"use client";
// 교수 화면 데이터 — 학생 StudentProvider와 같은 자리. 레이아웃에서 한 번만 읽고 메뉴를 옮겨도 다시 읽지 않는다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { professorApi, ProfessorAccessError } from "@/lib/professor/api";
import {
  forgetProfessorData,
  loadProfessorData,
  peekProfessorData,
  professorRoot,
  type ProfessorMode,
} from "@/lib/professor/source";
import type { ProfessorData } from "@/lib/professor/types";
import { createClient } from "@/lib/supabase/client";
import { watchWorkspaceChanges } from "@/lib/workspace-refresh";

type Ctx = {
  mode: ProfessorMode;
  live: boolean;
  /** /professor 또는 /professor-demo */
  root: string;
  data: ProfessorData | null;
  setData: (d: ProfessorData) => void;
  error: string;
  forbidden: boolean;
  /** 실데이터 쓰기 뒤 · 다시 시도 */
  reload: () => Promise<void>;
  /** Mock 저장소 초기화 */
  resetMock: () => Promise<void>;
};

const Context = createContext<Ctx | null>(null);

export function ProfessorProvider({
  mode,
  children,
}: {
  mode: ProfessorMode;
  children: ReactNode;
}) {
  const [data, setData] = useState<ProfessorData | null>(() =>
    peekProfessorData(mode),
  );
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await loadProfessorData(mode);
      setData(next);
      setError("");
      setForbidden(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.",
      );
      setForbidden(e instanceof ProfessorAccessError);
    }
  }, [mode]);

  useEffect(() => {
    // 마운트 직후 1회 (상태 갱신은 비동기 콜백 안에서만)
    let active = true;
    void (async () => {
      if (active) await reload();
    })();
    // 실시간 모드: 팀 작업 · 문서 · 회의가 바뀌면 다시 읽는다
    const stop =
      mode === "live" ? watchWorkspaceChanges(createClient(), reload) : undefined;
    return () => {
      active = false;
      stop?.();
    };
  }, [reload, mode]);

  const resetMock = useCallback(async () => {
    try {
      await professorApi.reset();
      forgetProfessorData(mode);
      await reload();
    } catch {
      setError("저장소를 사용할 수 없습니다. 브라우저 저장 권한을 확인하세요.");
    }
  }, [mode, reload]);

  const value = useMemo(
    () => ({
      mode,
      live: mode === "live",
      root: professorRoot(mode),
      data,
      setData,
      error,
      forbidden,
      reload,
      resetMock,
    }),
    [mode, data, error, forbidden, reload, resetMock],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProfessor() {
  const value = useContext(Context);
  if (!value) throw new Error("ProfessorProvider is required");
  return value;
}

/** 본문: 로딩 · 오류 처리 (학생 StudentGate와 같은 모양) — 통과하면 data가 있다 */
export function ProfessorGate({ children }: { children: ReactNode }) {
  const { data, error, forbidden, live, reload, resetMock } = useProfessor();
  if (error)
    return (
      <section className="lamp-empty" role="alert">
        <h2>
          {forbidden ? "접근 권한이 없습니다" : "데이터를 불러오지 못했어요"}
        </h2>
        <p>{error}</p>
        <button className="lamp-button" onClick={() => void reload()}>
          다시 시도
        </button>{" "}
        {!forbidden && !live && (
          <button
            className="lamp-button secondary"
            onClick={() => void resetMock()}
          >
            데모 팀 초기화
          </button>
        )}{" "}
        <Link
          className="lamp-button secondary"
          href={live ? "/login" : "/lamp"}
        >
          {live ? "다른 계정으로 로그인" : "학생 데모"}
        </Link>
      </section>
    );
  if (!data)
    return (
      <div className="lamp-loading" role="status">
        <span className="lamp-spinner" />
        워크스페이스를 준비하고 있어요…
      </div>
    );
  return <>{children}</>;
}

/** 담당 범위 밖 · 없는 과목/팀 */
export function ProfessorDenied({ text }: { text: string }) {
  const { root } = useProfessor();
  return (
    <section className="lamp-empty" role="alert">
      <h2>접근 권한이 없습니다</h2>
      <p>{text}</p>
      <Link className="lamp-button secondary" href={root}>
        모든 수업으로 돌아가기
      </Link>
    </section>
  );
}
