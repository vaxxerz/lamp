"use client";
// 대시보드 — 지금 들어와 있는 프로젝트(팀) 하나의 전체 요약
//  1 어디까지 왔나(작업 진행률)  2 남은 일은 누가 하나  3 문서 · 회의는  4 최근 무엇이 바뀌었나  5 팀원별로 어떻게 나뉘었나
//  다른 프로젝트 목록은 /lamp 첫 화면(팀 타일)에서 본다.
//  데이터에 없는 값(마감일 · 우선순위 · 점수)은 만들지 않는다.
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, UserPlus, X } from "lucide-react";
import { useStudent } from "./StudentProvider";
import { Avatar, DocumentIcon, PageHeading, StatusBadge, TaskStatusIcon, relativeTime } from "./ui";
import { Dialog } from "./Dialog";
import type { ContributionActivity, Task, Workspace } from "@/lib/student/types";

const DAY = 86_400_000;
const STATUS_ORDER: Record<Task["status"], number> = { doing: 0, todo: 1, done: 2 };
const STATUS_LABEL: Record<Task["status"], string> = { todo: "할 일", doing: "진행 중", done: "완료" };

/** 팀원 초대 (초대코드 · 팀원 목록) */
function InviteDialog({ ws, close }: { ws: Workspace; close: () => void }) {
  const { team, users, me } = ws;
  const [copied, setCopied] = useState(false);
  return (
    <Dialog close={close} labelId="team-title">
      <section className="lamp-modal">
        <div className="lamp-modal-head">
          <h2 id="team-title">팀원 초대</h2>
          <button autoFocus className="lamp-icon-button" aria-label="닫기" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <p className="lamp-muted">
          {team.track === "independent"
            ? "독립 팀플 — 교수님 없이 우리끼리 쓰는 팀이에요."
            : `${team.courseName} · 교수님이 팀 기여를 함께 봐요.`}
        </p>
        {team.inviteCode && (
          <div className="lamp-invite-box">
            <code>{team.inviteCode}</code>
            <button
              className="lamp-button secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(team.inviteCode ?? "");
                setCopied(true);
              }}
            >
              {copied ? "복사됨" : "코드 복사"}
            </button>
          </div>
        )}
        <p className="lamp-help">팀원이 &quot;새 프로젝트 · 참여&quot;에서 이 코드를 입력하면 합류해요.</p>
        <ul className="lamp-team-members">
          {users.map((u, i) => (
            <li key={u.id}>
              <Avatar name={u.name} tone={i % 4} size="sm" />
              <strong>{u.name}</strong>
              <span>
                {u.id === me.id ? "나" : "팀원"}
                {team.members.find((m) => m.userId === u.id)?.role === "leader" ? " · 팀장" : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}

function verb(a: ContributionActivity) {
  return a.actionType === "add" ? "내용을 추가했습니다" : a.actionType === "delete" ? "내용을 삭제했습니다" : "내용을 수정했습니다";
}

export function Dashboard() {
  const { ws } = useStudent();
  const { me, team, users, tasks, meetings, activities, documents } = ws;
  const live = ws.mode === "live";
  const [invite, setInvite] = useState(false);
  const [now] = useState(() => Date.now());
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name;
  const toneOf = (id: string | null) => Math.max(0, users.findIndex((u) => u.id === id)) % 4;

  // 1 진행 상황 — 작업 상태별 개수
  const count = { todo: 0, doing: 0, done: 0 } as Record<Task["status"], number>;
  for (const t of tasks) count[t.status]++;
  const progress = tasks.length ? Math.round((count.done / tasks.length) * 100) : null;
  const awaitingCheck = tasks.filter((t) => t.status === "done" && !t.verifiedBy).length;

  // 2 지금 진행 중인 일 (팀 전체, 내 작업 먼저)
  const openTasks = tasks
    .filter((t) => t.status !== "done")
    .sort(
      (a, b) =>
        Number(b.assigneeId === me.id) - Number(a.assigneeId === me.id) ||
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.position - b.position,
    );
  const myOpen = openTasks.filter((t) => t.assigneeId === me.id).length;

  // 3 회의
  const upcoming = meetings
    .filter((m) => Date.parse(m.heldAt) >= now - 2 * 3_600_000)
    .sort((a, b) => Date.parse(a.heldAt) - Date.parse(b.heldAt));
  const nextMeeting = upcoming[0];
  const pastMeetings = meetings.length - upcoming.length;

  // 4 최근 활동 · 문서
  const recent = [...activities].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const week = recent.filter((a) => now - Date.parse(a.timestamp) < 7 * DAY).length;
  const docs = [...documents].sort((a, b) => Date.parse(b.updatedAt ?? "0") - Date.parse(a.updatedAt ?? "0"));
  const totalChanges = documents.reduce((n, d) => n + d.changeCount, 0);

  // 5 팀원별 분배
  const confirmed = activities.filter((a) => a.attributionStatus === "verified");
  const workload = users
    .map((u) => ({
      ...u,
      leader: team.members.find((m) => m.userId === u.id)?.role === "leader",
      open: tasks.filter((t) => t.assigneeId === u.id && t.status !== "done").length,
      completed: tasks.filter((t) => t.completedBy === u.id).length,
      activity: confirmed.filter((a) => a.userId === u.id).length,
    }))
    .sort((a, b) => b.activity + b.completed - (a.activity + a.completed));
  const maxActivity = Math.max(1, ...workload.map((w) => w.activity));

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Seoul",
    }).format(new Date(iso));

  return (
    <>
      <PageHeading
        title={team.name}
        description={`${team.track === "independent" ? "독립 팀플" : team.courseName} · 팀원 ${users.length}명 — 프로젝트 전체 현황이에요.`}
        action={
          team.inviteCode ? (
            <button className="lamp-button secondary" onClick={() => setInvite(true)}>
              <UserPlus size={14} /> 팀원 초대
            </button>
          ) : undefined
        }
      />

      {/* A 개요 */}
      <dl className="lamp-metrics">
        <div>
          <dt>작업 진행률</dt>
          <dd className="lamp-num">{progress === null ? "—" : `${progress}%`}</dd>
          <p>{tasks.length ? `완료 ${count.done} / 전체 ${tasks.length}` : "아직 작업이 없어요"}</p>
        </div>
        <div>
          <dt>진행 중인 작업</dt>
          <dd className="lamp-num">{openTasks.length}</dd>
          <p>{openTasks.length ? `내 작업 ${myOpen}개` : "남은 작업 없음"}</p>
        </div>
        <div>
          <dt>회의</dt>
          <dd className="lamp-num">{meetings.length}</dd>
          <p>{nextMeeting ? `다음 ${fmtDate(nextMeeting.heldAt)}` : `지난 회의 ${pastMeetings}회 · 예정 없음`}</p>
        </div>
        <div>
          <dt>최근 7일 활동</dt>
          <dd className="lamp-num">{week}</dd>
          <p>
            문서 {documents.length}개 · 변경 {totalChanges}회
          </p>
        </div>
      </dl>

      <div className="lamp-dash-layout">
        <div className="lamp-dash-main">
          {/* B 진행 상황 */}
          <section className="lamp-section-block" aria-labelledby="dash-progress">
            <header className="lamp-block-title">
              <h2 id="dash-progress">진행 상황</h2>
              <Link className="lamp-text-button" href="/lamp/board">
                작업 보드 <ArrowRight size={14} />
              </Link>
            </header>
            {tasks.length === 0 ? (
              <div className="lamp-empty-inline">
                <p>{live ? "아직 작업이 없어요. 작업 보드에서 할 일을 나눠 보세요." : "작업 보드는 로그인하면 실데이터로 쓸 수 있어요."}</p>
                <Link className="lamp-button secondary" href="/lamp/board">
                  작업 보드 열기
                </Link>
              </div>
            ) : (
              <>
                <div
                  className="lamp-stack-bar"
                  role="img"
                  aria-label={`완료 ${count.done}, 진행 중 ${count.doing}, 할 일 ${count.todo}`}
                >
                  {(["done", "doing", "todo"] as const).map((s) =>
                    count[s] ? <span key={s} className={`is-${s}`} style={{ flexGrow: count[s] }} /> : null,
                  )}
                </div>
                <ul className="lamp-stack-legend">
                  {(["done", "doing", "todo"] as const).map((s) => (
                    <li key={s}>
                      <i className={`is-${s}`} aria-hidden="true" />
                      {STATUS_LABEL[s]} <b className="lamp-num">{count[s]}</b>
                    </li>
                  ))}
                  {awaitingCheck > 0 && (
                    <li>
                      <StatusBadge tone="warning">팀원 확인 대기 {awaitingCheck}</StatusBadge>
                    </li>
                  )}
                </ul>

                {openTasks.length > 0 && (
                  <div className="lamp-table-scroll">
                    <table className="lamp-table">
                      <thead>
                        <tr>
                          <th scope="col" className="w-status">
                            상태
                          </th>
                          <th scope="col">남은 작업</th>
                          <th scope="col">담당</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openTasks.slice(0, 8).map((t) => (
                          <tr key={t.id} className={t.assigneeId === me.id ? "is-me" : undefined}>
                            <td className="w-status">
                              <span className="lamp-status-cell">
                                <TaskStatusIcon status={t.status} />
                                <span>{STATUS_LABEL[t.status]}</span>
                              </span>
                            </td>
                            <td>
                              <Link className="lamp-row-title" href="/lamp/board">
                                {t.title}
                              </Link>
                            </td>
                            <td>
                              {t.assigneeId ? (
                                <span className="lamp-member">
                                  <Avatar name={nameOf(t.assigneeId) ?? "?"} tone={toneOf(t.assigneeId)} size="sm" />
                                  <span>{t.assigneeId === me.id ? "나" : (nameOf(t.assigneeId) ?? "팀원")}</span>
                                </span>
                              ) : (
                                <span className="lamp-cell-muted">미배정</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {openTasks.length > 8 && <p className="lamp-footnote">외 {openTasks.length - 8}개는 작업 보드에서 볼 수 있어요.</p>}
                  </div>
                )}
              </>
            )}
          </section>

          {/* C 문서 */}
          <section className="lamp-section-block" aria-labelledby="dash-docs">
            <header className="lamp-block-title">
              <h2 id="dash-docs">
                연결된 문서 <span className="lamp-count">{documents.length}</span>
              </h2>
              <Link className="lamp-text-button" href="/lamp/documents">
                문서 <ArrowRight size={14} />
              </Link>
            </header>
            {docs.length === 0 ? (
              <div className="lamp-empty-inline">
                <p>아직 연결된 문서가 없어요.</p>
                <Link className="lamp-button secondary" href="/lamp/documents">
                  문서 연결하기
                </Link>
              </div>
            ) : (
              <div className="lamp-table-scroll">
                <table className="lamp-table">
                  <thead>
                    <tr>
                      <th scope="col">문서</th>
                      <th scope="col" className="num">
                        변경
                      </th>
                      <th scope="col">마지막 수정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.slice(0, 5).map((d) => (
                      <tr key={d.id}>
                        <td>
                          <span className="lamp-member">
                            <DocumentIcon type={d.type} />
                            <Link className="lamp-row-title" href="/lamp/documents">
                              {d.name}
                            </Link>
                          </span>
                        </td>
                        <td className="num lamp-num">{d.changeCount}</td>
                        <td className="lamp-cell-muted">
                          {d.updatedAt ? <time dateTime={d.updatedAt}>{relativeTime(d.updatedAt, now)}</time> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="lamp-dash-side">
          {/* D 팀원 */}
          <section className="lamp-section-block" aria-labelledby="dash-workload">
            <header className="lamp-block-title">
              <h2 id="dash-workload">팀원별 현황</h2>
              <Link className="lamp-text-button" href="/lamp/analysis">
                기여 분석 <ArrowRight size={14} />
              </Link>
            </header>
            <table className="lamp-table lamp-table-compact">
              <thead>
                <tr>
                  <th scope="col">팀원</th>
                  <th scope="col" className="num">
                    진행
                  </th>
                  <th scope="col" className="num">
                    완료
                  </th>
                  <th scope="col">확인된 활동</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((w) => (
                  <tr key={w.id} className={w.id === me.id ? "is-me" : undefined}>
                    <td>
                      <span className="lamp-member">
                        <Avatar name={w.name} tone={toneOf(w.id)} size="sm" />
                        <span>
                          {w.name}
                          {w.leader && <small className="lamp-cell-muted"> · 팀장</small>}
                        </span>
                      </span>
                    </td>
                    <td className="num lamp-num">{w.open}</td>
                    <td className="num lamp-num">{w.completed}</td>
                    <td>
                      <span className="lamp-progress-inline">
                        <span className="lamp-bar thin" aria-hidden="true">
                          <span style={{ width: `${(w.activity / maxActivity) * 100}%` }} />
                        </span>
                        <span className="lamp-num">{w.activity}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lamp-footnote">활동 수는 측정값이에요. 기여의 질을 뜻하지 않아요.</p>
          </section>

          {/* E 최근 활동 */}
          <section className="lamp-section-block" aria-labelledby="dash-activity">
            <header className="lamp-block-title">
              <h2 id="dash-activity">최근 활동</h2>
              <Link className="lamp-text-button" href="/lamp/activities">
                전체 <ArrowRight size={14} />
              </Link>
            </header>
            {recent.length === 0 ? (
              <div className="lamp-empty-inline">
                <p>아직 기록이 없어요. 연결된 문서를 제안 모드로 수정하면 여기에 쌓여요.</p>
              </div>
            ) : (
              <ol className="lamp-feed">
                {recent.slice(0, 6).map((a) => {
                  const who =
                    a.attributionStatus === "unknown"
                      ? (a.authorName ?? "작성자 미확인")
                      : (nameOf(a.userId) ?? a.authorName ?? "작성자 미확인");
                  const doc = documents.find((d) => d.id === a.documentId);
                  return (
                    <li key={a.id}>
                      <Link href={`/lamp/activities#${a.id}`}>
                        <Avatar name={who} tone={toneOf(a.userId)} size="sm" />
                        <span className="lamp-feed-body">
                          <span>
                            <b>{who}</b>님이 {verb(a)}
                          </span>
                          <small>
                            {doc?.name ?? "문서"} · <time dateTime={a.timestamp}>{relativeTime(a.timestamp, now)}</time>
                            {a.attributionStatus !== "verified" && (
                              <> · 작성자 {a.attributionStatus === "inferred" ? "추정" : "미확인"}</>
                            )}
                          </small>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>

      {invite && <InviteDialog ws={ws} close={() => setInvite(false)} />}
    </>
  );
}
