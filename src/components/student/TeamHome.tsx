"use client";
// /lamp 첫 화면 — 모든 프로젝트 대시보드: 내가 속한 팀플 전체를 한눈에 요약하고, 고르면 그 팀의 대시보드로 들어간다.
//  팀 하나의 상세 요약은 /lamp/dashboard (Dashboard.tsx). Mock(로그인 전)은 예시 팀 하나라 바로 그 팀 대시보드.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, GraduationCap, Plus, UsersRound } from "lucide-react";
import { Dashboard } from "./Dashboard";
import { useStudent } from "./StudentProvider";
import { NewTeamDialog } from "./Onboarding";
import { PageHeading, StatusBadge, TaskStatusIcon, relativeTime } from "./ui";
import { loadTeamsOverview, type TeamOverview } from "@/lib/student/live";

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));

export function TeamHome() {
  const { ws, selectTeam, supabase } = useStudent();
  const router = useRouter();
  const live = ws.mode === "live";
  const [overview, setOverview] = useState<TeamOverview[] | null>(null);
  const [now] = useState(() => Date.now());
  const [newTeam, setNewTeam] = useState(false);
  const teamKey = ws.teams.map((t) => t.id).join(",");

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    loadTeamsOverview(supabase, teamKey ? teamKey.split(",") : [], ws.me.id)
      .then((o) => !cancelled && setOverview(o))
      .catch(() => !cancelled && setOverview([]));
    return () => {
      cancelled = true;
    };
  }, [live, supabase, teamKey, ws.me.id]);

  if (!live) return <Dashboard />;

  const open = async (teamId: string, path = "dashboard") => {
    if (teamId !== ws.team.id) await selectTeam(teamId);
    router.push(`/lamp/${path}`);
  };
  const ov = (id: string) => overview?.find((o) => o.teamId === id);
  const nameOf = (id: string) => ws.teams.find((t) => t.id === id)?.name ?? "";

  const all = overview ?? [];
  const myOpen = all.flatMap((o) => o.myOpen.map((t) => ({ ...t, teamId: o.teamId })));
  const meetings = all
    .filter((o) => o.nextMeeting)
    .map((o) => ({ teamId: o.teamId, ...o.nextMeeting! }))
    .sort((a, b) => Date.parse(a.heldAt) - Date.parse(b.heldAt));
  const week = all.reduce((n, o) => n + o.weekActivity, 0);
  const activeTeams = all.filter((o) => o.weekActivity > 0).length;
  const loading = overview === null;
  const dash = (v: number | string) => (loading ? "…" : v);

  return (
    // lamp-home: 이 화면에서는 사이드바를 숨긴다 (CSS :has) — 팀을 고르기 전이라 팀 메뉴가 필요 없음
    <div className="lamp-home">
      <PageHeading
        title={`${ws.me.name}님의 팀플`}
        description="참여 중인 모든 프로젝트를 한눈에 봐요. 팀을 고르면 그 프로젝트의 대시보드로 들어가요."
      />

      <dl className="lamp-metrics">
        <div>
          <dt>참여 중인 프로젝트</dt>
          <dd className="lamp-num">{ws.teams.length}</dd>
          <p>
            과목 {ws.teams.filter((t) => t.track === "class").length} · 독립 {ws.teams.filter((t) => t.track === "independent").length}
          </p>
        </div>
        <div>
          <dt>내 남은 작업</dt>
          <dd className="lamp-num">{dash(myOpen.length)}</dd>
          <p>{loading ? "불러오는 중" : `진행 중 ${myOpen.filter((t) => t.status === "doing").length}개 · 전체 프로젝트`}</p>
        </div>
        <div>
          <dt>다가오는 회의</dt>
          <dd className="lamp-num">{dash(meetings.length)}</dd>
          <p>{meetings[0] ? `${fmtDate(meetings[0].heldAt)} · ${nameOf(meetings[0].teamId)}` : "예정된 회의 없음"}</p>
        </div>
        <div>
          <dt>최근 7일 활동</dt>
          <dd className="lamp-num">{dash(week)}</dd>
          <p>{loading ? "불러오는 중" : `활동한 프로젝트 ${activeTeams}개`}</p>
        </div>
      </dl>

      <div className="lamp-team-tiles">
        {ws.teams.map((t) => {
          const o = ov(t.id);
          const pct = o && o.taskTotal ? Math.round((o.taskDone / o.taskTotal) * 100) : null;
          return (
            <button key={t.id} className="lamp-card lamp-team-tile" onClick={() => void open(t.id)}>
              <span className="lamp-soft-icon">{t.track === "independent" ? <UsersRound size={22} /> : <GraduationCap size={22} />}</span>
              <strong>{t.name}</strong>
              <small>
                {t.track === "class" ? `${t.courseName} · ` : ""}팀원 {t.memberCount}명
                {t.id === ws.team.id && " · 최근 본 팀"}
              </small>
              <span className="lamp-tile-stats">
                <span className="lamp-progress-inline">
                  <span className="lamp-bar" aria-hidden="true">
                    <span style={{ width: `${pct ?? 0}%` }} />
                  </span>
                  <span className="lamp-num">{o ? (o.taskTotal ? `작업 ${o.taskDone}/${o.taskTotal}` : "작업 없음") : "…"}</span>
                </span>
                <span>
                  {o
                    ? `내 작업 ${o.myOpen.length} · 문서 ${o.docCount} · ${o.lastActivityAt ? `활동 ${relativeTime(o.lastActivityAt, now)}` : "활동 없음"}`
                    : ""}
                </span>
              </span>
              <span className="lamp-team-tile-go">
                대시보드 <ChevronRight size={15} />
              </span>
            </button>
          );
        })}
        <button className="lamp-card lamp-team-tile lamp-team-tile-new" onClick={() => setNewTeam(true)}>
          <span className="lamp-soft-icon">
            <Plus size={22} />
          </span>
          <strong>새 팀 만들기 · 참여</strong>
          <small>친구들과 새로 시작하거나, 팀 초대코드 · 과목 코드로 들어가요</small>
        </button>
      </div>
      {newTeam && <NewTeamDialog close={() => setNewTeam(false)} />}

      <div className="lamp-dash-layout lamp-home-overview">
        <section className="lamp-section-block" aria-labelledby="home-tasks">
          <header className="lamp-block-title">
            <h2 id="home-tasks">
              내 남은 작업 <span className="lamp-count">{myOpen.length}</span>
            </h2>
          </header>
          {myOpen.length === 0 ? (
            <div className="lamp-empty-inline">
              <p>{loading ? "불러오는 중…" : "모든 프로젝트에서 나에게 남은 작업이 없어요."}</p>
            </div>
          ) : (
            <div className="lamp-table-scroll">
              <table className="lamp-table">
                <thead>
                  <tr>
                    <th scope="col" className="w-status">
                      상태
                    </th>
                    <th scope="col">작업</th>
                    <th scope="col">프로젝트</th>
                  </tr>
                </thead>
                <tbody>
                  {[...myOpen]
                    .sort((a, b) => Number(b.status === "doing") - Number(a.status === "doing"))
                    .slice(0, 10)
                    .map((t) => (
                      <tr key={t.id}>
                        <td className="w-status">
                          <span className="lamp-status-cell">
                            <TaskStatusIcon status={t.status} />
                            <span>{t.status === "doing" ? "진행 중" : "할 일"}</span>
                          </span>
                        </td>
                        <td>
                          <button className="lamp-row-link" onClick={() => void open(t.teamId, "board")}>
                            {t.title}
                          </button>
                        </td>
                        <td className="lamp-cell-muted">{nameOf(t.teamId)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="lamp-section-block" aria-labelledby="home-meetings">
          <header className="lamp-block-title">
            <h2 id="home-meetings">다가오는 회의</h2>
          </header>
          {meetings.length === 0 ? (
            <div className="lamp-empty-inline">
              <p>{loading ? "불러오는 중…" : "예정된 회의가 없어요."}</p>
            </div>
          ) : (
            <ol className="lamp-feed">
              {meetings.slice(0, 6).map((m) => (
                <li key={`${m.teamId}-${m.heldAt}`}>
                  <button className="lamp-row-link" onClick={() => void open(m.teamId, "meetings")}>
                    <span className="lamp-feed-body">
                      <span>
                        <b>{m.title}</b>
                      </span>
                      <small>
                        {nameOf(m.teamId)} · <time dateTime={m.heldAt}>{fmtDate(m.heldAt)}</time>
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {!loading && all.some((o) => o.taskTotal && o.taskDone === o.taskTotal) && (
            <p className="lamp-footnote">
              <StatusBadge tone="success">작업 완료</StatusBadge>{" "}
              {all
                .filter((o) => o.taskTotal && o.taskDone === o.taskTotal)
                .map((o) => nameOf(o.teamId))
                .join(", ")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
