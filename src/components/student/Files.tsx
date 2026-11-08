"use client";
// 파일 (기존 등잔 파일 보관함): 업로드 → 같은 이름이면 새 버전, 서버가 텍스트 추출 · 이전 버전과 비교
import { useRef, useState } from "react";
import { Download, FileUp, LogIn } from "lucide-react";
import { fileDownloadUrl, uploadTeamFile } from "@/lib/student/live";
import type { FileVersion } from "@/lib/student/types";
import { useStudent } from "./StudentProvider";
import { EmptyState, PageHeading, formatTime } from "./ui";

function summaryText(v: FileVersion) {
  const parts: string[] = [];
  if (v.version === 1) parts.push("첫 버전");
  if (v.charsAdded || v.charsRemoved) parts.push(`+${v.charsAdded} / −${v.charsRemoved}자`);
  if (v.summary.slides_changed?.length) parts.push(`슬라이드 ${v.summary.slides_changed.join("·")} 수정`);
  if (v.summary.slides_added?.length) parts.push(`슬라이드 ${v.summary.slides_added.join("·")} 추가`);
  if (v.summary.slides_removed) parts.push(`슬라이드 ${v.summary.slides_removed}장 삭제`);
  return parts.join(" · ") || "내용 비교 불가 형식";
}

const size = (b: number | null) => (b == null ? "" : b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.ceil(b / 1e3)}KB`);

export function Files() {
  const { ws, supabase, act } = useStudent();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (ws.mode !== "live")
    return (
      <>
        <PageHeading title="파일" description="결과물 파일을 올리면 버전별로 무엇이 바뀌었는지 기록돼요." />
        <EmptyState>
          <a className="lamp-button" href="/login?next=%2Flamp%2Ffiles">
            <LogIn size={16} /> 로그인하면 팀 파일함을 쓸 수 있어요
          </a>
        </EmptyState>
      </>
    );

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      for (const f of Array.from(files)) await act(() => uploadTeamFile(supabase, ws.team.id, f));
      setMessage("업로드했어요. 같은 이름의 파일은 새 버전으로 기록돼요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드하지 못했습니다.");
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  async function download(path: string) {
    try {
      window.open(await fileDownloadUrl(supabase, path), "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "다운로드 링크를 만들지 못했습니다.");
    }
  }

  const name = (id: string) => ws.users.find((u) => u.id === id)?.name ?? "팀원";

  return (
    <>
      <PageHeading
        title="파일"
        description="pptx · docx · xlsx · pdf 등 결과물을 올리면 버전마다 바뀐 내용과 올린 사람이 기록돼요."
        action={
          <button className="lamp-button" disabled={pending} onClick={() => input.current?.click()}>
            <FileUp size={17} />
            {pending ? "올리는 중…" : "파일 올리기"}
          </button>
        }
      />
      <input ref={input} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
      {error && (
        <p className="lamp-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="lamp-success" role="status">
          {message}
        </p>
      )}
      <div className="lamp-document-list">
        {ws.files.length ? (
          ws.files.map((f) => (
            <details key={f.id} className="lamp-card lamp-file">
              <summary>
                <strong>{f.name}</strong>
                <span className="lamp-muted">
                  v{f.latestVersion} · {formatTime(f.updatedAt)}
                </span>
              </summary>
              <ul>
                {f.versions.map((v) => (
                  <li key={v.version}>
                    <b>v{v.version}</b> · {name(v.uploaderId)} · {formatTime(v.createdAt)} · {summaryText(v)}{" "}
                    <span className="lamp-muted">{size(v.sizeBytes)}</span>
                    <button className="lamp-text-button" onClick={() => void download(v.storagePath)}>
                      <Download size={14} /> 받기
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))
        ) : (
          <EmptyState>아직 올린 파일이 없어요. 오른쪽 위 &quot;파일 올리기&quot;로 시작해 보세요.</EmptyState>
        )}
      </div>
    </>
  );
}
