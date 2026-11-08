"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  ListFilter,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import type { ProfessorData } from "@/lib/professor/types";
import { ATTENDANCE_LABEL } from "@/lib/types";
import { ActivityCard } from "@/components/student/ActivityTimeline";
import {
  Avatar,
  DocumentCard,
  EmptyState,
  PageHeading,
  formatTime,
} from "@/components/student/ui";
import { Dialog } from "@/components/student/Dialog";
import { ProfessorDenied, useProfessor } from "./ProfessorProvider";
import { ProfessorDocumentDetail } from "./ProfessorDocumentDetail";
import { WeeklyBars } from "@/components/student/Analysis";
import { AiReport } from "@/components/analysis/AiReport";
import { inputFromActivities } from "@/lib/analysis/rules";
import {
  analyzeTeam,
  type AnalysisPeriod,
} from "@/lib/professor/member-analysis";
import {
  ANALYSIS_PERIODS,
  MemberTable,
  PeriodSelect,
  ShareBar,
  memberColor,
} from "./MemberAnalysis";
/** Student-style presentation of the selected professor-scoped team, with no write APIs. */
export function ProfessorTeamWorkspace({
  teamId,
  view,
  recordId,
  studentId,
  docId,
  documentFilter,
}: {
  teamId: string;
  view: string;
  recordId?: string;
  /** /documents/:docId — 문서 하나의 분석 화면 */
  docId?: string;
  /** ?doc= — 문서 분석에서 그 문서의 기록으로 들어올 때 */
  documentFilter?: string;
  /** ?student= — 팀원 분석에서 그 팀원의 기록으로 들어올 때 */
  studentId?: string;
}) {
  // ProfessorGate를 통과한 뒤에만 그려진다 — data가 있다
  const professor = useProfessor();
  const { live, root } = professor;
  const data = professor.data as ProfessorData;
  const [showTeam, setShowTeam] = useState(false);
  const [student, setStudent] = useState(studentId ?? "all");
  const [period, setPeriod] = useState<AnalysisPeriod>("all");
  const [now] = useState(() => Date.now());
  const [document, setDocument] = useState(documentFilter ?? "all");
  const [sort, setSort] = useState("newest");
  const [limit, setLimit] = useState(recordId ? Number.MAX_SAFE_INTEGER : 10);
  const [selectedMeeting, setSelectedMeeting] = useState("");
  useEffect(() => {
    if (!data || !recordId || view !== "activities") return;
    const frame = requestAnimationFrame(() =>
      globalThis.document
        .getElementById(recordId)
        ?.scrollIntoView({ block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [data, recordId, view]);
  const team = data.teams.find((t) => t.id === teamId);
  if (!team)
    return (
      <ProfessorDenied text="담당 과목에 속하지 않거나 존재하지 않는 팀입니다." />
    );
  const base = `${root}/teams/${encodeURIComponent(team.id)}`;
  const course = data.courses.find((c) => c.id === team.courseId)!;
  const users = data.users.filter((u) =>
    team.members.some((m) => m.userId === u.id),
  );
  const docs = data.documents.filter((d) => d.teamId === team.id);
  const activities = data.activities
    .filter((a) => a.teamId === team.id)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const confirmed = activities.filter(
    (a) => a.attributionStatus === "verified",
  );
  const meetings = data.meetings.filter((m) => m.teamId === team.id);
  const meeting = meetings.find((m) => m.id === selectedMeeting) ?? meetings[0];
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "미제공";
  const toneOf = (id: string) =>
    Math.max(0, team.members.findIndex((m) => m.userId === id)) % 4;
  const filtered = activities
    .filter(
      (a) =>
        (student === "all" ||
          (a.attributionStatus !== "unknown" && a.userId === student)) &&
        (document === "all" || a.documentId === document),
    )
    .sort(
      (a, b) =>
        (sort === "newest" ? -1 : 1) *
        (Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    );
  const analysis = analyzeTeam(data, team.id, {
    period: view === "analysis" ? period : "all",
    now,
  });
  const weekMax = Math.max(
    1,
    ...analysis.members.flatMap((m) => m.weeks.map((w) => w.count)),
  );
  return (
    <>
      {view === "dashboard" && (
        <>
          <PageHeading
            title={team.name}
            description={`${course.name} · 팀원 ${users.length}명 — 학생 대시보드와 같은 구성으로 보는 프로젝트 전체 현황이에요.`}
            action={
              <button
                className="lamp-button secondary"
                onClick={() => setShowTeam(true)}
              >
                <UsersRound size={14} /> 팀 정보 보기
              </button>
            }
          />
          <dl className="lamp-metrics">
            <div>
              <dt>감지된 변경 기록</dt>
              <dd className="lamp-num">{activities.length}</dd>
              <p>연결 문서의 모든 수정</p>
            </div>
            <div>
              <dt>확인된 기여 활동</dt>
              <dd className="lamp-num">{confirmed.length}</dd>
              <p>작성자가 확인된 기록만</p>
            </div>
            <div>
              <dt>연결된 문서</dt>
              <dd className="lamp-num">{docs.length}</dd>
              <p>Google Docs · Slides · Sheets</p>
            </div>
            <div>
              <dt>팀원</dt>
              <dd className="lamp-num">{users.length}</dd>
              <p>{course.name}</p>
            </div>
          </dl>
          <p className="lamp-footnote">
            교수 조회에서는 개인을 대신하지 않습니다. 활동량은 참고 지표이며
            성적이나 공정성을 자동 판정하지 않습니다.
          </p>
          <section className="lamp-section">
            <div className="lamp-section-title">
              <div>
                <h2>팀원별 기여</h2>
                <p>작성자가 확인·추정된 변경의 글자 수 비중이에요.</p>
              </div>
              <Link className="lamp-text-button" href={`${base}/analysis`}>
                팀원 분석 <ChevronRight size={16} />
              </Link>
            </div>
            <div className="lamp-card prof-team-share-card">
              {analysis.members.length ? (
                <ShareBar members={analysis.members} />
              ) : (
                <EmptyState>아직 참여한 팀원이 없습니다.</EmptyState>
              )}
            </div>
          </section>
          <section className="lamp-section">
            <div className="lamp-section-title">
              <div>
                <h2>최근 활동</h2>
                <p>우리 팀의 작은 변화들을 모았어요.</p>
              </div>
              <Link className="lamp-text-button" href={`${base}/activities`}>
                전체 보기 <ChevronRight size={16} />
              </Link>
            </div>
            <div className="lamp-recent lamp-card">
              {activities.length ? (
                activities
                  .slice(0, 4)
                  .map((a) => (
                    <ActivityCard
                      key={a.id}
                      activity={a}
                      users={users}
                      documents={docs}
                      compact
                    />
                  ))
              ) : (
                <EmptyState>이 팀에는 아직 활동 기록이 없습니다.</EmptyState>
              )}
            </div>
          </section>
          <div className="lamp-bottom-grid">
            <Link className="lamp-quick-card" href={`${base}/meetings`}>
              <span className="lamp-soft-icon">
                <UsersRound size={22} />
              </span>
              <div>
                <h3>회의록과 출석을 함께 살펴봐요</h3>
                <p>팀의 회의 기록을 확인해 보세요.</p>
              </div>
              <ArrowRight size={20} />
            </Link>
            <Link className="lamp-quick-card" href={`${base}/analysis`}>
              <span className="lamp-soft-icon">
                <Sparkles size={22} />
              </span>
              <div>
                <h3>기록이 모여, AI 팀원 분석으로</h3>
                <p>확인된 활동을 근거로 한 팀원별 분석을 확인해 보세요.</p>
              </div>
              <ArrowRight size={20} />
            </Link>
          </div>
        </>
      )}
      {view === "analysis" && (
        <>
          <PageHeading
            title="팀원 분석"
            description={`${team.name}의 팀원별 변경 기록 · 변경량 비중 · 활동한 주 · 회의 출석이에요. 작성자 미확인 기록은 개인에게 넣지 않아요.`}
            action={<PeriodSelect value={period} change={setPeriod} />}
          />
          {live ? (
            <AiReport
              mode="live"
              teamId={team.id}
              period={period}
              toneOf={toneOf}
              memberHref={(u) => `${base}/activities?student=${encodeURIComponent(u)}`}
            />
          ) : (
            <AiReport
              mode="mock"
              teamId={team.id}
              period={period}
              toneOf={toneOf}
              memberHref={(u) => `${base}/activities?student=${encodeURIComponent(u)}`}
              audience="professor"
              input={inputFromActivities({
                team: { id: team.id, name: team.name, track: "class", course: course ? { name: course.name } : undefined },
                members: team.members.map((m) => ({ id: m.userId, name: name(m.userId), role: m.role })),
                activities: data.activities.filter((a) => a.teamId === team.id),
                meetings: data.meetings.filter((m) => m.teamId === team.id),
                documents: data.documents.filter((d) => d.teamId === team.id),
                period,
                now,
              })}
            />
          )}
          <header className="lamp-block-title lamp-analysis-raw-title">
            <h2>측정 데이터</h2>
            <span className="lamp-cell-muted">AI 분석의 근거가 되는 집계</span>
          </header>
          <section className="lamp-card lamp-analysis-card">
            <div className="lamp-analysis-head">
              <div>
                <h2>주별 변경</h2>
                <p>
                  {ANALYSIS_PERIODS.find((p) => p.id === period)?.label} · 총{" "}
                  {analysis.total}건 (확인 {analysis.verified} · 추정{" "}
                  {analysis.inferred} · 미확인 {analysis.unknown})
                </p>
              </div>
              {analysis.notes.length > 0 && (
                <span className="prof-notes">
                  {analysis.notes.map((n) => (
                    <span key={n} className="prof-status inferred">
                      {n}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <WeeklyBars
              data={analysis.weeks}
              max={Math.max(1, ...analysis.weeks.map((w) => w.count))}
              height={220}
            />
          </section>
          <section
            className="lamp-analysis-compare"
            aria-labelledby="member-compare"
          >
            <header className="lamp-block-title">
              <h2 id="member-compare">팀원 비교</h2>
              <span className="lamp-cell-muted">
                {ANALYSIS_PERIODS.find((p) => p.id === period)?.label}
              </span>
            </header>
            {analysis.members.length > 0 && (
              <ShareBar members={analysis.members} />
            )}
            <MemberTable
              analysis={analysis}
              weeks={analysis.weeks.length}
              now={now}
              historyHref={(u) =>
                `${base}/activities?student=${encodeURIComponent(u)}`
              }
            />
            <p className="lamp-footnote">
              모두 측정된 값이에요. 공동 편집은 편집 비율로 나눠요. 기여의
              질이나 성적·공정성을 판정하지 않아요.
            </p>
          </section>
          <div className="lamp-analysis-members">
            {analysis.members.map((m) => (
              <article key={m.userId} className="lamp-card lamp-analysis-card">
                <div className="lamp-analysis-member">
                  <Avatar name={m.name} tone={m.index % 4} />
                  <div>
                    <strong>
                      {m.name}
                      {m.role === "leader" && <em> · 팀장</em>}
                    </strong>
                    <p>
                      변경 {m.count}건 · 문서 {m.docs}개{" "}
                      <span className="lamp-plus">
                        {m.added.toLocaleString()}자 ++
                      </span>{" "}
                      <span className="lamp-minus">
                        {m.removed.toLocaleString()}자 --
                      </span>
                    </p>
                  </div>
                  <span
                    className="lamp-analysis-rank"
                    style={{ borderColor: memberColor(m.index) }}
                  >
                    {Math.round(m.share * 100)}%
                  </span>
                </div>
                <WeeklyBars data={m.weeks} max={weekMax} height={140} compact />
                <p className="lamp-analysis-split">
                  {m.notes.length
                    ? `살펴볼 점: ${m.notes.join(" · ")}`
                    : `활동한 주 ${m.activeWeeks}/${analysis.weeks.length}주 · 회의 출석 ${m.attendance.present}/${m.attendance.checked}`}{" "}
                  ·{" "}
                  <Link
                    href={`${base}/activities?student=${encodeURIComponent(m.userId)}`}
                  >
                    기록 보기
                  </Link>
                </p>
              </article>
            ))}
          </div>
        </>
      )}
      {view === "documents" && docId && (
        <ProfessorDocumentDetail base={base} docId={docId} docs={docs} live={live} />
      )}
      {view === "documents" && !docId && (
        <>
          <PageHeading
            title="연결된 Google 문서"
            description="이 팀이 사용하는 문서와 발표자료를 확인합니다. 교수 조회는 읽기 전용입니다."
          />
          <div className="lamp-section-title lamp-list-heading">
            <span>
              전체 문서 <b>{docs.length}</b>
            </span>
            <span className="lamp-muted">
              {live ? "읽기 전용" : "Mock · 읽기 전용"}
            </span>
          </div>
          <div className="lamp-document-list">
            {docs.length ? (
              docs.map((d) => (
                <DocumentCard
                  key={d.id}
                  document={d}
                  href={`${base}/documents/${encodeURIComponent(d.id)}`}
                />
              ))
            ) : (
              <EmptyState>이 팀에 연결된 문서가 없습니다.</EmptyState>
            )}
          </div>
        </>
      )}
      {view === "activities" && (
        <>
          <PageHeading
            title="기여 기록"
            description={`${team.name}의 모든 변경 기록을 확인하세요. 원본 기록은 수정하거나 삭제할 수 없습니다.`}
          />
          <div className="lamp-filters prof-filter-bar">
            <div className="lamp-segments" role="group" aria-label="학생">
              {[{ id: "all", name: "전체" }, ...users].map((u) => (
                <button
                  key={u.id}
                  className={student === u.id ? "active" : ""}
                  aria-pressed={student === u.id}
                  onClick={() => {
                    setStudent(u.id);
                    setLimit(10);
                  }}
                >
                  {u.name}
                </button>
              ))}
            </div>
            <div className="lamp-filter-selects">
              <label>
                <span className="lamp-sr-only">문서</span>
                <select
                  value={document}
                  onChange={(e) => {
                    setDocument(e.target.value);
                    setLimit(10);
                  }}
                >
                  <option value="all">모든 문서</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="lamp-sr-only">시간 정렬</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="newest">최신순</option>
                  <option value="oldest">오래된 순</option>
                </select>
              </label>
            </div>
          </div>
          <div className="lamp-results">
            <span>
              <ListFilter size={15} />총 {filtered.length}개의 활동
            </span>
            <p>
              {student === "all"
                ? "미확인 기록도 함께 보여 줍니다."
                : "학생을 고르면 작성자가 확인 · 추정된 기록만 보여 줍니다."}
            </p>
          </div>
          {filtered.length ? (
            <div className="lamp-timeline">
              {filtered.slice(0, limit).map((a) => (
                <ActivityCard
                  key={a.id}
                  activity={a}
                  users={users}
                  documents={docs}
                />
              ))}
            </div>
          ) : (
            <EmptyState>
              이 팀의 기록이 없거나 필터에 맞는 기록이 없습니다.
            </EmptyState>
          )}
          {limit < filtered.length && (
            <button
              className="lamp-button secondary"
              onClick={() => setLimit(limit + 10)}
            >
              더 보기
            </button>
          )}
        </>
      )}
      {view === "meetings" && (
        <>
          <PageHeading
            title="회의록 · 출석"
            description="팀의 회의록과 출석을 읽기 전용으로 확인합니다. 본인 출석은 다른 팀원이 확인하는 기존 정책을 유지합니다."
          />
          {meeting ? (
            <div className="lamp-meetings-layout">
              <aside className="lamp-meeting-list lamp-card">
                <h2>
                  회의 목록 <span>{meetings.length}</span>
                </h2>
                {meetings.map((m) => (
                  <button
                    key={m.id}
                    className={meeting.id === m.id ? "active" : ""}
                    onClick={() => setSelectedMeeting(m.id)}
                  >
                    <strong>{m.title}</strong>
                    <small>{formatTime(m.heldAt)}</small>
                  </button>
                ))}
              </aside>
              <section className="lamp-card prof-team-meeting">
                <div className="lamp-meeting-title">
                  <h2>{meeting.title}</h2>
                  <p>
                    {formatTime(meeting.heldAt)} · {meeting.location}
                  </p>
                </div>
                <h3>회의록</h3>
                <p className="prof-team-notes">
                  {meeting.notes || "등록된 회의록이 없습니다."}
                </p>
                <h3>팀원별 출석</h3>
                {users.map((u) => (
                  <div key={u.id} className="prof-team-attendance">
                    <Avatar name={u.name} />
                    <strong>{u.name}</strong>
                    <span>
                      {
                        ATTENDANCE_LABEL[
                          meeting.attendance[u.id] ?? "unchecked"
                        ]
                      }
                    </span>
                    <small>
                      {meeting.confirmations[u.id]
                        ? `확인: ${name(meeting.confirmations[u.id].userId)} · ${formatTime(meeting.confirmations[u.id].at)}`
                        : "확인자·시각 미제공"}
                    </small>
                  </div>
                ))}
              </section>
            </div>
          ) : (
            <EmptyState>이 팀에는 아직 회의 기록이 없습니다.</EmptyState>
          )}
        </>
      )}
      {showTeam && (
        <Dialog close={() => setShowTeam(false)} labelId="preview-team-title">
          <section className="lamp-modal">
            <div className="lamp-section-title">
              <h2 id="preview-team-title">팀 정보</h2>
              <button
                autoFocus
                className="lamp-icon-button"
                aria-label="팀 정보 닫기"
                onClick={() => setShowTeam(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h3>{team.name}</h3>
            <p className="lamp-muted">
              {course.name}
              {team.createdBy &&
                ` · ${team.createdBy === "student" ? "학생 생성 팀" : "교수 생성 팀"}`}
            </p>
            <div className="lamp-team-members">
              {users.map((u, i) => (
                <div key={u.id}>
                  <Avatar name={u.name} tone={i} />
                  <strong>{u.name}</strong>
                  <span>
                    {team.members.find((m) => m.userId === u.id)?.role ===
                    "leader"
                      ? "팀장"
                      : "팀원"}
                  </span>
                </div>
              ))}
            </div>
            {!users.length && (
              <EmptyState>아직 참여한 팀원이 없습니다.</EmptyState>
            )}
          </section>
        </Dialog>
      )}
    </>
  );
}
