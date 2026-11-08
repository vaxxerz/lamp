"use client";
import { useState } from "react";
import { ListFilter } from "lucide-react";
import { toggleKudos } from "@/lib/student/live";
import type { ActivityEvent } from "@/lib/student/types";
import { useStudent } from "./StudentProvider";
import { Avatar, EmptyState, PageHeading, formatTime } from "./ui";
import { ActivityTimeline } from "./ActivityTimeline";
const EVENT_LABEL: Record<string, string> = {
  doc_edit: "Lamp 문서 작성",
  external_doc_edit: "구글 문서 수정",
  task_create: "할 일 만들기",
  task_complete: "할 일 완료",
  meeting_note: "회의록 작성",
  meeting_attend: "회의 참석",
  file_version: "파일 버전 올리기",
};

function eventTitle(e: ActivityEvent) {
  const m = e.meta as Record<string, string | number | boolean | undefined>;
  const name = m.title ?? m.document_title ?? m.file_name ?? "";
  const extra =
    e.type === "task_complete" && m.verified
      ? " · 팀원 확인됨"
      : e.type === "meeting_attend" && m.status === "late"
        ? " · 지각"
        : m.source === "suggestion"
          ? " · 제안(작성자 확정)"
          : "";
  return `${EVENT_LABEL[e.type] ?? e.type}${name ? ` · ${name}` : ""}${extra}`;
}

/** 점수의 근거가 되는 모든 활동 + 팀원 활동에 👍 (본인 활동은 불가, DB도 차단) */
function EventTimeline() {
  const { ws, supabase, act } = useStudent();
  const [error, setError] = useState("");
  if (!ws.events.length) return <EmptyState>아직 점수에 반영된 활동이 없어요.</EmptyState>;
  const name = (id: string) => ws.users.find((u) => u.id === id)?.name ?? "팀원";
  return (
    <>
      {error && (
        <p className="lamp-error" role="alert">
          {error}
        </p>
      )}
      <div className="lamp-timeline">
        {ws.events.map((e) => {
          const mine = e.userId === ws.me.id;
          const given = e.kudosFrom.includes(ws.me.id);
          return (
            <article key={e.id} className="lamp-activity">
              <div className="lamp-timeline-dot" />
              <Avatar name={name(e.userId)} tone={ws.users.findIndex((u) => u.id === e.userId)} />
              <div className="lamp-activity-body">
                <div className="lamp-activity-top">
                  <div>
                    <h3>{eventTitle(e)}</h3>
                    <p>
                      {name(e.userId)} · {formatTime(e.createdAt)} · {e.points}점
                    </p>
                  </div>
                  <button
                    className={`lamp-kudos ${given ? "active" : ""}`}
                    disabled={mine}
                    title={mine ? "본인 활동에는 👍를 줄 수 없어요" : given ? "👍 취소" : "👍 인정하기"}
                    aria-pressed={given}
                    onClick={() => {
                      setError("");
                      act(() => toggleKudos(supabase, ws.team.id, e.id, ws.me.id, given)).catch((err) =>
                        setError(err instanceof Error ? err.message : "👍를 저장하지 못했습니다."),
                      );
                    }}
                  >
                    👍 {e.kudosFrom.length || ""}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function Activities({ initialDoc = null }: { initialDoc?: string | null }) {
  const { ws } = useStudent();
  const { activities, me } = ws;
  const [view, setView] = useState<"docs" | "events">("docs");
  const [scope, setScope] = useState("all");
  // 문서 분석 화면의 "수정 기록"(?doc=)으로 들어오면 그 문서로 필터 (page가 searchParams로 넘겨줌).
  // 클라이언트 이동 중에는 window.location이 아직 이전 주소라 직접 읽으면 안 됨.
  const [document, setDocument] = useState(() =>
    initialDoc && ws.documents.some((d) => d.id === initialDoc) ? initialDoc : "all",
  );
  const [sort, setSort] = useState("latest");
  const filtered = activities
    .filter(
      (a) =>
        (scope === "all" ||
          (scope === "mine"
            ? a.userId === me.id
            : a.userId !== null && a.userId !== me.id)) &&
        (document === "all" || a.documentId === document),
    )
    .sort(
      (a, b) =>
        (sort === "latest" ? -1 : 1) *
        (Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    );
  return (
    <>
      <PageHeading
        title="활동 기록"
        description="문서에서 수집된 작업 내용과 작성자 정보를 확인할 수 있습니다."
      />
      {ws.mode === "live" && (
        <div className="lamp-tabs" aria-label="기록 종류">
          {[
            { id: "docs", label: "문서 기록" },
            { id: "events", label: "전체 활동 · 👍" },
          ].map((t) => (
            <button
              key={t.id}
              aria-pressed={view === t.id}
              className={view === t.id ? "active" : ""}
              onClick={() => setView(t.id as "docs" | "events")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {view === "events" ? (
        <EventTimeline />
      ) : (
      <>
      <div className="lamp-filters">
        <div className="lamp-segments" aria-label="활동 범위">
          {[
            { id: "all", label: "전체 활동" },
            { id: "mine", label: "내 활동" },
            { id: "team", label: "팀원 활동" },
          ].map((t) => (
            <button
              key={t.id}
              className={scope === t.id ? "active" : ""}
              aria-pressed={scope === t.id}
              onClick={() => setScope(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="lamp-filter-selects">
          <label>
            <span className="lamp-sr-only">문서별 필터</span>
            <select
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            >
              <option value="all">모든 문서</option>
              {ws.documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="lamp-sr-only">시간 정렬</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="latest">최신순</option>
              <option value="oldest">오래된 순</option>
            </select>
          </label>
        </div>
      </div>
      <div className="lamp-results">
        <span>
          <ListFilter size={15} />총 {filtered.length}개의 활동
        </span>
        <p>추정·미확인 기록은 확인된 활동 수에 포함하지 않습니다.</p>
      </div>
      <ActivityTimeline activities={filtered} />
      </>
      )}
    </>
  );
}
