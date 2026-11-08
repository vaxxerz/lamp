"use client";

import { usePathname } from "next/navigation";
import {
  ICON,
  creditsOf,
  groupShareIssues,
  suggestionAuthor,
  useGoogleDocs,
  type CreditView,
  type Revision,
  type Suggestion,
} from "./useGoogleDocs";

/**
 * recordsHref가 있으면(/lamp) 문서별 기록 목록 대신 "기여 기록에서 보기" 링크만 보여준다.
 * 기록은 기여 기록 화면 한곳에 모으기 위해서. 없으면(기존 /student) 패널 안에 목록을 그대로 보여준다.
 */
export function GoogleDocsPanel({
  teamId,
  recordsHref,
}: {
  teamId: string;
  recordsHref?: (docId: string) => string;
}) {
  const pathname = usePathname();
  const {
    myGoogle,
    docs,
    revisions,
    suggestions,
    members,
    busy,
    message,
    sync,
    addDoc,
    disconnect,
    shareIssues,
  } = useGoogleDocs(teamId);

  const unconnected = members.filter((m) => !m.connected);

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">구글 문서 · 슬라이드 · 시트</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          {myGoogle === null && (
            <a
              href={`/api/google/connect?returnTo=${encodeURIComponent(pathname)}`}
              className="btn-primary"
            >
              구글 계정 연결
            </a>
          )}
          {myGoogle && (
            <>
              <span className="min-w-0 text-zinc-500 [overflow-wrap:anywhere]">
                {myGoogle}
              </span>
              <button
                onClick={disconnect}
                className="shrink-0 text-zinc-400 underline"
              >
                해제
              </button>
              <button
                onClick={addDoc}
                disabled={!!busy}
                className="btn-primary shrink-0"
              >
                {busy === "add" ? "연결 중…" : "+ 구글 문서 연결"}
              </button>
            </>
          )}
          <button
            onClick={() => sync(true)}
            disabled={!!busy || docs.length === 0}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 disabled:opacity-40 dark:border-zinc-700"
          >
            {busy === "sync" ? "동기화 중…" : "동기화"}
          </button>
        </div>
      </div>

      {message && (
        // 글자색도 배경과 같이 지정: /lamp처럼 글자색이 고정된 화면에서 다크 모드 배경만 바뀌어 안 읽히는 문제 방지
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
          {message}
        </p>
      )}

      {groupShareIssues(shareIssues).map((i) => (
        <p key={`${i.docId}:${i.reason}`} className="text-xs text-amber-700 dark:text-amber-400">
          공유 실패 · {i.title}
          {i.names.length > 0 && ` (${i.names.join(", ")})`} — {i.text}
        </p>
      ))}

      {unconnected.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          구글 미연결: {unconnected.map((m) => m.name).join(", ")} — 연결하기
          전까지 이 팀원의 구글 문서 수정은 기여로 반영되지 않아요 (연결하면
          과거 이력도 소급 반영).
        </p>
      )}

      {docs.length === 0 ? (
        <p className="text-sm text-zinc-500">연결된 구글 문서가 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {docs.map((doc) => {
            const revs = revisions.filter((r) => r.external_doc_id === doc.id);
            const sugs = suggestions.filter(
              (x) => x.external_doc_id === doc.id,
            );
            const byAuthor = new Map<string, number>();
            const add = (name: string, chars: number) =>
              byAuthor.set(name, (byAuthor.get(name) ?? 0) + chars);
            revs.forEach((r) =>
              creditsOf(r).forEach((c) => add(c.name, c.added)),
            );
            sugs.forEach((x) => add(suggestionAuthor(x), x.chars_added));
            return (
              <li
                key={doc.id}
                className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={doc.web_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline"
                  >
                    {ICON[doc.mime_type] ?? "📄"} {doc.title}
                  </a>
                  <span className="text-xs text-zinc-500">
                    {doc.last_synced_at
                      ? `동기화 ${new Date(doc.last_synced_at).toLocaleTimeString("ko-KR")}`
                      : "동기화 전"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {[...byAuthor]
                    .map(([name, chars]) => `${name} +${chars}자`)
                    .join(" · ") || "수정 이력 없음"}
                </p>
                {recordsHref ? (
                  <a
                    className="mt-2 inline-block text-xs font-medium underline"
                    href={recordsHref(doc.id)}
                  >
                    기여 기록에서 보기 → (제안 {sugs.length}건 · 수정{" "}
                    {revs.length}건)
                  </a>
                ) : (
                  <>
                    {sugs.length > 0 && <SuggestionList suggestions={sugs} />}
                    {revs.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-zinc-500">
                          수정 이력 {revs.length}건
                        </summary>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {revs.slice(0, 20).map((r) => (
                            <li key={r.id}>
                              {new Date(r.modified_at).toLocaleString("ko-KR")}{" "}
                              · {creditLabel(r)} ·{" "}
                              {r.text_available
                                ? `+${r.chars_added} / −${r.chars_removed}`
                                : "내용 비교 불가"}
                              {r.changes.length > 0 && (
                                <ChangeList revision={r} />
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** 편집 시간대 (Activity 기준) — 없으면 빈 문자열 */
function editWindow(c: CreditView) {
  if (!c.from || !c.to) return "";
  return c.from === c.to
    ? ` ${time(c.from)}`
    : ` ${time(c.from)}~${time(c.to)}`;
}

function creditLabel(r: Revision) {
  const credits = creditsOf(r);
  if (credits.length > 1) {
    return `${credits.map((c) => `${c.name} ${Math.round(c.share * 100)}%${editWindow(c)}`).join(" · ")} (공동 편집 · 편집 시간 비율 추정)`;
  }
  const only = credits[0];
  return only.confidence === "fallback" && r.credits.length > 0
    ? `${only.name} (마지막 수정자 기준)`
    : `${only.name}${editWindow(only)}`;
}

/** 어디가 바뀌었는지: 줄 번호 + 앞뒤 문맥 + 추가(초록) · 삭제(빨강) */
function ChangeList({ revision }: { revision: Revision }) {
  return (
    <details className="ml-4 mt-0.5">
      <summary className="cursor-pointer text-zinc-400">
        바뀐 부분 {revision.changes.length + revision.changes_truncated}곳
      </summary>
      <ul className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-2 dark:border-zinc-800">
        {revision.changes.map((f, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            <span className="text-zinc-400">{f.line}번째 줄 · </span>
            {f.before && <span className="text-zinc-400">…{f.before}</span>}
            {f.removed && (
              <del className="rounded bg-red-100 px-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">
                {f.removed}
              </del>
            )}
            {f.added && (
              <ins className="rounded bg-green-100 px-0.5 text-green-800 no-underline dark:bg-green-950 dark:text-green-300">
                {f.added}
              </ins>
            )}
            {f.after && <span className="text-zinc-400">{f.after}…</span>}
          </li>
        ))}
        {revision.changes_truncated > 0 && (
          <li className="text-zinc-400">
            외 {revision.changes_truncated}곳 (구글 문서의 버전 기록에서 확인)
          </li>
        )}
      </ul>
    </details>
  );
}

/** 제안 모드로 쓴 수정: 누가 · 언제 · 무엇을 (추정 없음) */
function SuggestionList({ suggestions }: { suggestions: Suggestion[] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-zinc-500">
        제안으로 정확히 기록 {suggestions.length}건{" "}
        <span className="text-zinc-400">(자동 수락됨)</span>
      </summary>
      <ul className="mt-1 flex flex-col gap-1">
        {suggestions.slice(0, 30).map((x) => (
          <li key={x.id} className="[overflow-wrap:anywhere]">
            <span className="text-zinc-500">
              {time(x.suggested_at ?? x.accepted_at)} · {suggestionAuthor(x)}{" "}
              ·{" "}
            </span>
            {x.removed_text.trim() && (
              <del className="rounded bg-red-100 px-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">
                {x.removed_text.trim()}
              </del>
            )}
            {x.added_text.trim() && (
              <ins className="rounded bg-green-100 px-0.5 text-green-800 no-underline dark:bg-green-950 dark:text-green-300">
                {x.added_text.trim()}
              </ins>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
