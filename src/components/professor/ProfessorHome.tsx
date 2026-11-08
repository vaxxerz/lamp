"use client";
// 교수 홈 — 담당 수업이 여러 개일 때 전체를 한눈에 보고, 수업을 골라 그 수업의 대시보드로 들어간다.
//  1 수업별 요약 타일  2 수업을 가로질러 살펴볼 팀  3 최근 변경
//  성적 · 공정성 판정은 하지 않는다. "살펴볼 점"은 기록 유무에서 나온 사실만 적는다.
import Link from "next/link";
import { ArrowRight, ChevronRight, GraduationCap } from "lucide-react";
import type { ProfessorData } from "@/lib/professor/types";

const DAY = 86_400_000;

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m || 1}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  return d < 31
    ? `${d}일 전`
    : new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function ProfessorHome({
  data,
  now,
  root,
}: {
  data: ProfessorData;
  now: number;
  root: string;
}) {
  const userName = (id: string | null) =>
    data.users.find((u) => u.id === id)?.name;
  const courseName = (id: string) =>
    data.courses.find((c) => c.id === id)?.name ?? "";
  const recentWeek = (iso: string) => now - Date.parse(iso) < 7 * DAY;

  const teamStats = data.teams.map((t) => {
    const acts = data.activities.filter((a) => a.teamId === t.id);
    const latest =
      acts
        .map((a) => a.timestamp)
        .sort()
        .at(-1) ?? null;
    const week = acts.filter((a) => recentWeek(a.timestamp)).length;
    const docs = data.documents.filter((d) => d.teamId === t.id).length;
    const verified = acts.filter(
      (a) => a.attributionStatus === "verified",
    ).length;
    const unknown = acts.filter(
      (a) => a.attributionStatus === "unknown",
    ).length;
    const notes: string[] = [];
    if (!t.members.length) notes.push("참여한 팀원 없음");
    if (!docs) notes.push("연결 문서 없음");
    if (acts.length && !week) notes.push("7일간 변경 없음");
    if (!acts.length && docs) notes.push("변경 기록 없음");
    if (acts.length >= 3 && unknown / acts.length >= 0.3)
      notes.push("작성자 미확인 기록 많음");
    return { team: t, acts, latest, week, docs, verified, unknown, notes };
  });

  const courses = data.courses.map((c) => {
    const ts = teamStats.filter((s) => s.team.courseId === c.id);
    const students = new Set(
      ts.flatMap((s) => s.team.members.map((m) => m.userId)),
    );
    const acts = ts.flatMap((s) => s.acts);
    return {
      course: c,
      teams: ts.length,
      students: students.size,
      docs: ts.reduce((n, s) => n + s.docs, 0),
      week: ts.reduce((n, s) => n + s.week, 0),
      latest:
        ts
          .map((s) => s.latest)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      attention: ts.filter((s) => s.notes.length).length,
      status: (["verified", "inferred", "unknown"] as const).map((k) => ({
        k,
        n: acts.filter((a) => a.attributionStatus === k).length,
      })),
    };
  });

  const allStudents = new Set(
    data.teams.flatMap((t) => t.members.map((m) => m.userId)),
  ).size;
  const weekTotal = teamStats.reduce((n, s) => n + s.week, 0);
  const watch = [...teamStats].sort(
    (a, b) =>
      b.notes.length - a.notes.length ||
      (b.latest ?? "").localeCompare(a.latest ?? ""),
  );
  const recent = [...data.activities]
    .filter((a) => data.teams.some((t) => t.id === a.teamId))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 6);
  const teamOf = (id: string) => data.teams.find((t) => t.id === id);

  return (
    <>
      <dl className="lamp-metrics">
        <div>
          <dt>담당 수업</dt>
          <dd className="lamp-num">{data.courses.length}</dd>
          <p>
            {[
              ...new Set(data.courses.map((c) => c.semester).filter(Boolean)),
            ].join(" · ") || "2026학년도 2학기"}
          </p>
        </div>
        <div>
          <dt>전체 팀</dt>
          <dd className="lamp-num">{data.teams.length}</dd>
          <p>
            살펴볼 점이 있는 팀 {teamStats.filter((s) => s.notes.length).length}
            개
          </p>
        </div>
        <div>
          <dt>참여 학생</dt>
          <dd className="lamp-num">{allStudents}</dd>
          <p>모든 수업 합계</p>
        </div>
        <div>
          <dt>최근 7일 변경</dt>
          <dd className="lamp-num">{weekTotal}</dd>
          <p>연결 문서의 수정 기록</p>
        </div>
      </dl>

      <section
        className="lamp-section-block prof-home-block"
        aria-labelledby="home-courses"
      >
        <header className="lamp-block-title">
          <h2 id="home-courses">
            내 수업 <span className="lamp-count">{courses.length}</span>
          </h2>
          <Link className="lamp-text-button" href={`${root}/courses`}>
            과목·팀 관리 <ArrowRight size={14} />
          </Link>
        </header>
        <div className="lamp-team-tiles">
          {courses.map((c) => (
            <Link
              key={c.course.id}
              className="lamp-card lamp-team-tile prof-course-tile"
              href={`${root}/dashboard?course=${c.course.id}`}
            >
              <span className="lamp-soft-icon">
                <GraduationCap size={22} />
              </span>
              <code>{c.course.inviteCode}</code>
              <strong>{c.course.name}</strong>
              <small>
                팀 {c.teams}개 · 학생 {c.students}명 · 문서 {c.docs}개
              </small>
              <span className="lamp-tile-stats">
                <span className="prof-status-row">
                  {c.status.map(({ k, n }) => (
                    <span key={k} className={`prof-status ${k}`}>
                      {k === "verified"
                        ? "확인"
                        : k === "inferred"
                          ? "추정"
                          : "미확인"}{" "}
                      {n}
                    </span>
                  ))}
                </span>
                <span>
                  최근 7일 변경 {c.week}건 ·{" "}
                  {c.latest ? `마지막 ${ago(c.latest, now)}` : "아직 기록 없음"}
                  {c.attention > 0 && ` · 살펴볼 팀 ${c.attention}`}
                </span>
              </span>
              <span className="lamp-team-tile-go">
                수업 대시보드 <ChevronRight size={15} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="lamp-dash-layout prof-home-block">
        <section className="lamp-section-block" aria-labelledby="home-teams">
          <header className="lamp-block-title">
            <h2 id="home-teams">
              모든 수업의 팀{" "}
              <span className="lamp-count">{data.teams.length}</span>
            </h2>
          </header>
          <div className="lamp-table-scroll">
            <table className="lamp-table">
              <thead>
                <tr>
                  <th scope="col">팀</th>
                  <th scope="col">수업</th>
                  <th scope="col" className="num">
                    팀원
                  </th>
                  <th scope="col" className="num">
                    7일 변경
                  </th>
                  <th scope="col">살펴볼 점</th>
                </tr>
              </thead>
              <tbody>
                {watch.map((s) => (
                  <tr key={s.team.id}>
                    <td>
                      <Link
                        className="lamp-row-title"
                        href={`${root}/teams/${s.team.id}/dashboard`}
                      >
                        {s.team.name}
                      </Link>
                    </td>
                    <td className="lamp-cell-muted">
                      {courseName(s.team.courseId)}
                    </td>
                    <td className="num lamp-num">{s.team.members.length}</td>
                    <td className="num lamp-num">{s.week}</td>
                    <td>
                      {s.notes.length ? (
                        <span className="prof-notes">
                          {s.notes.map((n) => (
                            <span key={n} className="prof-status inferred">
                              {n}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="lamp-cell-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lamp-footnote">
            살펴볼 점은 기록이 있는지 없는지만 알려줘요. 기여의 질이나 성적을
            판정하지 않아요.
          </p>
        </section>

        <section className="lamp-section-block" aria-labelledby="home-recent">
          <header className="lamp-block-title">
            <h2 id="home-recent">최근 변경</h2>
          </header>
          {recent.length ? (
            <ol className="lamp-feed">
              {recent.map((a) => {
                const who =
                  a.attributionStatus === "unknown"
                    ? "작성자 미확인"
                    : (userName(a.userId) ?? "작성자 미확인");
                const t = teamOf(a.teamId);
                return (
                  <li key={a.id}>
                    <Link
                      href={`${root}/teams/${encodeURIComponent(a.teamId)}/activities?record=${encodeURIComponent(a.id)}`}
                    >
                      <span className="lamp-feed-body">
                        <span>
                          <b>{who}</b> · {a.title}
                        </span>
                        <small>
                          {t ? `${courseName(t.courseId)} · ${t.name}` : ""} ·{" "}
                          <time dateTime={a.timestamp}>
                            {ago(a.timestamp, now)}
                          </time>
                          {a.attributionStatus === "inferred" &&
                            " · 작성자 추정"}
                        </small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="lamp-empty-inline">
              <p>아직 변경 기록이 없어요.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
