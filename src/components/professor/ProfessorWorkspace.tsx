"use client";
// 수업 단위 화면 — 모든 수업(홈) · 수업 대시보드(팀별 지표만) · 과목·팀 관리.
//  팀원별 분석 · 기록 · 회의록은 팀 화면(/teams/[teamId]/…)에서만 본다.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronRight, Copy, Plus, UsersRound } from "lucide-react";
import type { ProfessorData } from "@/lib/professor/types";
import { professorApi } from "@/lib/professor/api";
import { createLiveCourse, createLiveTeam } from "@/lib/professor/live";
import { analyzeTeam } from "@/lib/professor/member-analysis";
import { createClient } from "@/lib/supabase/client";
import { PageHeading, relativeTime } from "@/components/student/ui";
import { ProfessorHome } from "./ProfessorHome";
import { ProfessorDenied, useProfessor } from "./ProfessorProvider";

const DAY = 86_400_000;
const TITLES: Record<string, string> = {
  dashboard: "전체 대시보드",
  courses: "과목·팀 관리",
};
function Empty({ text }: { text: string }) {
  return (
    <div className="prof-empty">
      <BookOpen size={32} />
      <h3>{text}</h3>
      <p>팀이 생기거나 새로운 활동이 기록될 때 다시 확인하세요.</p>
    </div>
  );
}
function ConfirmDialog({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      aria-labelledby="confirm-title"
      className="prof-native-dialog"
    >
      <div className="lamp-app prof-app prof-card">
        <h2 id="confirm-title">팀 초대코드를 재발급할까요?</h2>
        <p>
          기존 초대코드는 더 이상 사용할 수 없습니다. 이 화면에서는 Mock 코드만
          변경됩니다.
        </p>
        <button autoFocus onClick={cancel}>
          취소
        </button>
        <button className="prof-primary" onClick={confirm}>
          재발급 확인
        </button>
      </div>
    </dialog>
  );
}
export function ProfessorWorkspace({
  view,
  query,
}: {
  view: string;
  /** 이 화면의 주소 쿼리 (서버가 넘겨준 값 — 숨겨 둔 이전 화면이 현재 주소를 따라가지 않도록) */
  query: URLSearchParams;
}) {
  // ProfessorGate를 통과한 뒤에만 그려진다 — data가 있다
  const professor = useProfessor();
  const { live, root, reload } = professor;
  const data = professor.data as ProfessorData;
  const setData = professor.setData;
  const courseId = query.get("course");
  const [newCourseName, setNewCourseName] = useState("");
  const [newSemester, setNewSemester] = useState("2026-2");
  const [notice, setNotice] = useState("");
  const [newName, setNewName] = useState("");
  const [newCourse, setNewCourse] = useState(courseId ?? "");
  const [now] = useState(() => Date.now());
  const [confirmTeam, setConfirmTeam] = useState<string | null>(null);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmTeam(null);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  if (courseId && !data.courses.some((c) => c.id === courseId))
    return (
      <ProfessorDenied text="담당 과목에 속하지 않거나 존재하지 않는 과목입니다. 다른 과목의 기록은 표시하지 않습니다." />
    );
  const isHome = view === "home";
  const course = (id: string) =>
    data.courses.find((c) => c.id === id)?.name ?? "알 수 없는 과목";
  const user = (id: string | null) =>
    data.users.find((u) => u.id === id)?.name ?? "작성자 미확인";
  const currentCourse = data.courses.find((c) => c.id === courseId);
  const teams = data.teams.filter((t) => !courseId || t.courseId === courseId);
  const members = new Set(teams.flatMap((t) => t.members.map((m) => m.userId)));
  const docs = data.documents.filter((d) =>
    teams.some((t) => t.id === d.teamId),
  );
  const recentWeek = (iso: string) => now - Date.parse(iso) < 7 * DAY;

  // 팀별 지표 — 팀 단위 숫자만. 팀원별 분석은 팀 화면에서
  const rows = teams.map((t) => {
    const a = analyzeTeam(data, t.id, { now });
    const acts = data.activities.filter((x) => x.teamId === t.id);
    const docCount = data.documents.filter((d) => d.teamId === t.id).length;
    const latest =
      acts
        .map((x) => x.timestamp)
        .sort()
        .at(-1) ?? null;
    const notes = [
      ...(!t.members.length ? ["참여한 팀원 없음"] : []),
      ...(!docCount ? ["연결 문서 없음"] : []),
      ...(acts.length && !acts.some((x) => recentWeek(x.timestamp))
        ? ["7일간 변경 없음"]
        : []),
      ...a.notes.filter((n) => !n.startsWith("변경량")),
    ];
    return {
      team: t,
      a,
      docCount,
      latest,
      week: acts.filter((x) => recentWeek(x.timestamp)).length,
      active: a.members.filter((m) => m.count > 0).length,
      meetings: data.meetings.filter((m) => m.teamId === t.id).length,
      notes,
    };
  });

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    const selected = newCourse || data!.courses[0]?.id;
    if (!newName.trim() || !data!.courses.some((c) => c.id === selected))
      return;
    if (live) {
      try {
        await createLiveTeam(createClient(), selected, newName);
        setNewName("");
        setNotice(
          "팀을 만들었어요. 학생은 과목 코드로 들어와 이 팀에 참여할 수 있어요.",
        );
        await reload();
      } catch (e) {
        setNotice(
          `팀을 만들지 못했어요: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
        );
      }
      return;
    }
    const next = [
      ...data!.teams,
      {
        id: crypto.randomUUID(),
        name: newName.trim(),
        courseId: selected,
        members: [],
        createdBy: "professor" as const,
        inviteCode: `TEAM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      },
    ];
    try {
      await professorApi.saveTeams(next);
      setData({ ...data!, teams: next });
      setNewName("");
      setNotice(
        "Mock 팀을 이 브라우저에 저장했어요. 실제 학생은 참여할 수 없습니다.",
      );
    } catch {
      setNotice("저장 실패: 브라우저 저장 권한을 확인해 주세요.");
    }
  }
  async function createCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!newCourseName.trim() || !newSemester.trim()) return;
    try {
      await createLiveCourse(
        createClient(),
        data!.professor.id,
        newCourseName,
        newSemester.trim(),
      );
      setNewCourseName("");
      setNotice(
        "과목을 열었어요. 과목 코드를 학생들에게 알려 주면 참여할 수 있어요.",
      );
      await reload();
    } catch (e) {
      setNotice(
        `과목을 열지 못했어요: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
      );
    }
  }
  async function rotate() {
    const next = data!.teams.map((t) =>
      t.id === confirmTeam
        ? {
            ...t,
            inviteCode: `TEAM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          }
        : t,
    );
    try {
      await professorApi.saveTeams(next);
      setData({ ...data!, teams: next });
      setConfirmTeam(null);
      setNotice("Mock 팀 초대코드를 재발급했어요.");
    } catch {
      setNotice("코드 저장에 실패했습니다.");
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("초대코드를 복사했어요.");
    } catch {
      setNotice(`복사할 수 없습니다. 코드를 직접 선택해 주세요: ${code}`);
    }
  }

  const title = isHome
    ? `${data.professor.name}님의 수업`
    : view === "dashboard" && currentCourse
      ? currentCourse.name
      : (TITLES[view] ?? "페이지를 찾을 수 없습니다");
  const description = isHome
    ? `담당 수업 ${data.courses.length}개를 한눈에 봐요. 수업을 고르면 그 수업의 대시보드로 들어가요.`
    : view === "dashboard"
      ? currentCourse
        ? `과목 코드 ${currentCourse.inviteCode} · 팀 ${teams.length}개 · 학생 ${members.size}명 — 팀별 지표예요. 팀을 누르면 팀원 분석과 기록을 볼 수 있어요.`
        : "모든 담당 수업의 팀별 지표예요. 팀을 누르면 팀원 분석과 기록을 볼 수 있어요."
      : currentCourse
        ? `${currentCourse.name}의 과목 코드와 팀을 관리해요.`
        : "담당 과목의 과목 코드와 팀을 관리해요.";
  return (
    <div className={isHome ? "lamp-home" : undefined}>
      <PageHeading title={title} description={description} />
      {notice && (
        <div className="prof-notice" role="status">
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {isHome && <ProfessorHome data={data} now={now} root={root} />}
      {view === "dashboard" && (
        <>
          <dl className="lamp-metrics">
            <div>
              <dt>팀</dt>
              <dd className="lamp-num">{teams.length}</dd>
              <p>
                살펴볼 점이 있는 팀 {rows.filter((r) => r.notes.length).length}
                개
              </p>
            </div>
            <div>
              <dt>참여 학생</dt>
              <dd className="lamp-num">{members.size}</dd>
              <p>{currentCourse ? currentCourse.name : "모든 담당 수업"}</p>
            </div>
            <div>
              <dt>연결 문서</dt>
              <dd className="lamp-num">{docs.length}</dd>
              <p>Google Docs · Slides · Sheets</p>
            </div>
            <div>
              <dt>최근 7일 변경</dt>
              <dd className="lamp-num">
                {rows.reduce((n, r) => n + r.week, 0)}
              </dd>
              <p>전체 {rows.reduce((n, r) => n + r.a.total, 0)}건 중</p>
            </div>
          </dl>
          <section
            className="lamp-section-block prof-home-block"
            aria-labelledby="team-metrics"
          >
            <header className="lamp-block-title">
              <h2 id="team-metrics">
                팀별 지표 <span className="lamp-count">{teams.length}</span>
              </h2>
            </header>
            {rows.length ? (
              <div className="lamp-table-scroll">
                <table className="lamp-table prof-team-table">
                  <thead>
                    <tr>
                      <th scope="col">팀</th>
                      {!currentCourse && <th scope="col">수업</th>}
                      <th scope="col" className="num">
                        팀원
                      </th>
                      <th scope="col" className="num">
                        문서
                      </th>
                      <th scope="col">변경 기록</th>
                      <th scope="col" className="num">
                        7일 변경
                      </th>
                      <th scope="col">변경한 팀원</th>
                      <th scope="col" className="num">
                        회의
                      </th>
                      <th scope="col">최근 변경</th>
                      <th scope="col">살펴볼 점</th>
                      <th scope="col">
                        <span className="lamp-sr-only">팀 들어가기</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const href = `${root}/teams/${encodeURIComponent(r.team.id)}/dashboard`;
                      return (
                        <tr key={r.team.id} className="prof-team-row">
                          <td>
                            <Link className="lamp-row-title" href={href}>
                              {r.team.name}
                            </Link>
                          </td>
                          {!currentCourse && (
                            <td className="lamp-cell-muted">
                              {course(r.team.courseId)}
                            </td>
                          )}
                          <td className="num lamp-num">
                            {r.team.members.length}
                          </td>
                          <td className="num lamp-num">{r.docCount}</td>
                          <td>
                            <span className="prof-status-row prof-status-inline">
                              <span className="lamp-num">{r.a.total}건</span>
                              <span className="prof-status verified">
                                확인 {r.a.verified}
                              </span>
                              <span className="prof-status inferred">
                                추정 {r.a.inferred}
                              </span>
                              <span className="prof-status unknown">
                                미확인 {r.a.unknown}
                              </span>
                            </span>
                          </td>
                          <td className="num lamp-num">{r.week}</td>
                          <td>
                            <span className="lamp-progress-inline">
                              <span
                                className="lamp-bar thin"
                                aria-hidden="true"
                              >
                                <span
                                  style={{
                                    width: r.team.members.length
                                      ? `${(r.active / r.team.members.length) * 100}%`
                                      : "0%",
                                  }}
                                />
                              </span>
                              <span className="lamp-num">
                                {r.active}/{r.team.members.length}명
                              </span>
                            </span>
                          </td>
                          <td className="num lamp-num">{r.meetings}</td>
                          <td className="lamp-cell-muted">
                            {r.latest ? relativeTime(r.latest, now) : "없음"}
                          </td>
                          <td>
                            {r.notes.length ? (
                              <span className="prof-notes">
                                {r.notes.map((n) => (
                                  <span
                                    key={n}
                                    className="prof-status inferred"
                                  >
                                    {n}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="lamp-cell-muted">—</span>
                            )}
                          </td>
                          <td>
                            <Link
                              className="lamp-text-button"
                              href={href}
                              aria-label={`${r.team.name} 들어가기`}
                            >
                              <ChevronRight size={16} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="선택한 과목에 팀이 없습니다." />
            )}
            <p className="lamp-footnote">
              팀 단위로 측정된 숫자예요. 팀원별 분석 · 기록 · 회의록은
              팀을 눌러 팀 화면에서 봐요. 성적이나 공정성을 판정하지 않아요.
            </p>
          </section>
        </>
      )}
      {view === "courses" && (
        <>
          {live && (
            <section className="prof-card prof-new-course">
              <h2>새 과목 열기</h2>
              <p>
                과목을 열면 과목 코드가 생겨요. 학생들은 그 코드로 과목에 들어와
                팀을 만들거나 참여해요.
              </p>
              <form className="prof-filters" onSubmit={createCourse}>
                <label>
                  과목 이름
                  <input
                    value={newCourseName}
                    onChange={(e) => setNewCourseName(e.target.value)}
                    maxLength={60}
                    placeholder="예: 소프트웨어공학"
                    required
                  />
                </label>
                <label>
                  학기
                  <input
                    value={newSemester}
                    onChange={(e) => setNewSemester(e.target.value)}
                    maxLength={10}
                    placeholder="2026-2"
                    required
                  />
                </label>
                <button className="prof-primary">
                  <Plus size={16} />
                  과목 열기
                </button>
              </form>
            </section>
          )}
          <section className="prof-card">
            <h2>{live ? "팀 만들기" : "교수 생성 팀"}</h2>
            <p>
              {live
                ? "담당 과목 안에 팀을 미리 만들어 둘 수 있어요. 학생은 과목 코드로 들어와 팀을 골라 참여해요."
                : "담당 과목에만 생성됩니다. Mock 초대코드는 실제 참여에 사용할 수 없습니다."}
            </p>
            <form className="prof-filters" onSubmit={createTeam}>
              <label>
                소속 과목
                <select
                  aria-label="소속 과목"
                  value={newCourse || data.courses[0]?.id || ""}
                  onChange={(e) => setNewCourse(e.target.value)}
                  required
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                팀 이름
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={60}
                  placeholder="새 팀 이름"
                  required
                />
              </label>
              <button className="prof-primary" disabled={!data.courses.length}>
                <Plus size={16} />팀 생성
              </button>
            </form>
          </section>
          <div className="prof-section-title">
            <h2>과목 초대코드</h2>
            <span>
              {live
                ? "학생에게 이 코드를 알려 주세요"
                : "팀 초대코드와 다릅니다"}
            </span>
          </div>
          <div className="prof-grid">
            {data.courses
              .filter((c) => !courseId || c.id === courseId)
              .map((c) => (
                <article className="prof-card" key={c.id}>
                  <h3>{c.name}</h3>
                  <p>
                    {live
                      ? `과목 참여 코드${c.semester ? ` · ${c.semester}` : ""}`
                      : "과목 참여용 · Mock"}
                  </p>
                  <code>{c.inviteCode}</code>
                  <button
                    className="prof-quiet"
                    aria-label={`${c.name} 과목 코드 복사`}
                    onClick={() => copy(c.inviteCode)}
                  >
                    <Copy size={15} />
                    복사
                  </button>
                </article>
              ))}
          </div>
          <div className="prof-section-title">
            <h2>팀과 팀원</h2>
            <span>학생 생성 팀도 함께 표시됩니다</span>
          </div>
          <TeamCards />
        </>
      )}
      {confirmTeam && (
        <ConfirmDialog cancel={() => setConfirmTeam(null)} confirm={rotate} />
      )}
    </div>
  );

  function TeamCards() {
    return teams.length ? (
      <div className="prof-grid">
        {teams.map((t) => {
          const activities = data!.activities.filter((a) => a.teamId === t.id);
          const latest = activities
            .map((a) => a.timestamp)
            .sort()
            .at(-1);
          return (
            <article className="prof-card prof-team" key={t.id}>
              <div className="prof-team-top">
                <span className="prof-team-icon">
                  <UsersRound size={22} />
                </span>
                {t.createdBy && (
                  <span className="prof-badge">
                    {t.createdBy === "student"
                      ? "학생 생성 팀"
                      : "교수 생성 팀"}
                  </span>
                )}
              </div>
              <p>{course(t.courseId)}</p>
              <h3>{t.name}</h3>
              <div className="prof-team-counts">
                <span>
                  팀원 <b>{t.members.length}명</b>
                </span>
                <span>
                  연결 문서{" "}
                  <b>
                    {data!.documents.filter((d) => d.teamId === t.id).length}개
                  </b>
                </span>
              </div>
              <p>
                최근 활동{" "}
                {latest ? relativeTime(latest, now) : "아직 기록 없음"}
              </p>
              <div className="prof-status-row">
                {(["verified", "inferred", "unknown"] as const).map((s) => (
                  <span key={s} className={`prof-status ${s}`}>
                    {s === "verified"
                      ? "확인"
                      : s === "inferred"
                        ? "추정"
                        : "미확인"}{" "}
                    {activities.filter((a) => a.attributionStatus === s).length}
                  </span>
                ))}
              </div>
              <>
                {t.inviteCode && (
                  <div className="prof-code">
                    <small>팀 참여용 · Mock</small>
                    <code>{t.inviteCode}</code>
                    <button
                      aria-label={`${t.name} 팀 코드 복사`}
                      onClick={() => copy(t.inviteCode!)}
                    >
                      <Copy size={16} />
                    </button>
                    <button onClick={() => setConfirmTeam(t.id)}>
                      코드 재발급
                    </button>
                  </div>
                )}
                <ul className="prof-member-list">
                  {t.members.map((m) => (
                    <li key={m.userId}>
                      <span className="prof-avatar">
                        {user(m.userId).slice(0, 1)}
                      </span>
                      {user(m.userId)}
                      {m.role === "leader" && (
                        <span className="prof-badge">팀장</span>
                      )}
                    </li>
                  ))}
                </ul>
                {!t.members.length && <p>아직 참여한 팀원이 없습니다.</p>}
              </>
              <Link
                className="prof-team-link"
                href={`${root}/teams/${t.id}/dashboard`}
              >
                팀 들어가기 <ChevronRight size={16} />
              </Link>
            </article>
          );
        })}
      </div>
    ) : (
      <Empty text="선택한 과목에 팀이 없습니다." />
    );
  }
}
