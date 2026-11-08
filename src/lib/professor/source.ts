// 교수 화면 데이터 출처: live = Supabase 실데이터(/professor), mock = 공개 예시(/professor-demo)
import { createClient } from "@/lib/supabase/client";
import { professorApi } from "./api";
import { loadProfessorLive } from "./live";
import type { ProfessorData } from "./types";

export type ProfessorMode = "live" | "mock";

export const professorRoot = (mode: ProfessorMode) =>
  mode === "live" ? "/professor" : "/professor-demo";

// 메뉴를 옮길 때마다 화면이 새로 마운트된다 — 마지막으로 읽은 데이터를 먼저 보여 주고 뒤에서 새로 읽는다.
//  (브라우저 메모리에만 둔다. 서버에서는 effect가 돌지 않아 채워지지 않는다.)
const cache: Partial<Record<ProfessorMode, ProfessorData>> = {};

export const peekProfessorData = (mode: ProfessorMode) => cache[mode] ?? null;

export async function loadProfessorData(
  mode: ProfessorMode,
): Promise<ProfessorData> {
  const data =
    mode === "live"
      ? await loadProfessorLive(createClient())
      : { ...(await professorApi.load()), mode: "mock" as const };
  cache[mode] = data;
  return data;
}

export function forgetProfessorData(mode: ProfessorMode) {
  delete cache[mode];
}
