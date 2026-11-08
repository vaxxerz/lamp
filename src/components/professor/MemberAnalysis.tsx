"use client";
// 교수용 팀원 분석 조각 — 수업 화면(팀원 분석)과 팀 조회 화면(팀원 분석 탭)이 함께 쓴다.
//  집계는 src/lib/professor/member-analysis.ts. 여기는 그리기만 한다.
import Link from "next/link";
import type {
  AnalysisPeriod,
  MemberAnalysis,
  TeamAnalysis,
} from "@/lib/professor/member-analysis";
import { Avatar, relativeTime } from "@/components/student/ui";
import { ActivityComposition } from "@/components/student/ActivityComposition";

export const ANALYSIS_PERIODS: { id: AnalysisPeriod; label: string }[] = [
  { id: "1m", label: "최근 1개월" },
  { id: "3m", label: "최근 3개월" },
  { id: "all", label: "전체" },
];

/** 팀원 색 — 문서 미리보기의 작성자 형광펜과 같은 순서 */
export const memberColor = (index: number) =>
  `var(--hl-${(index % 6) + 1}-dot)`;

export function PeriodSelect({
  value,
  change,
}: {
  value: AnalysisPeriod;
  change: (p: AnalysisPeriod) => void;
}) {
  return (
    <label className="lamp-analysis-period">
      <span className="lamp-sr-only">기간</span>
      <select
        aria-label="분석 기간"
        value={value}
        onChange={(e) => change(e.target.value as AnalysisPeriod)}
      >
        {ANALYSIS_PERIODS.map((p) => (
          <option key={p.id} value={p.id}>
            기간: {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 팀 변경량을 팀원별로 쌓은 막대 + 범례 */
export function ShareBar({ members }: { members: MemberAnalysis[] }) {
  const has = members.some((m) => m.share > 0);
  return (
    <div className="prof-share">
      <span
        className="prof-share-bar"
        role="img"
        aria-label={
          has
            ? `변경량 비중: ${members.map((m) => `${m.name} ${pct(m.share)}`).join(", ")}`
            : "개인에게 귀속된 변경 없음"
        }
      >
        {has ? (
          members
            .filter((m) => m.share > 0)
            .map((m) => (
              <span
                key={m.userId}
                style={{ flex: m.share, background: memberColor(m.index) }}
              />
            ))
        ) : (
          <span className="empty" />
        )}
      </span>
      <ul className="prof-share-legend" aria-hidden="true">
        {members.map((m) => (
          <li key={m.userId}>
            <i style={{ background: memberColor(m.index) }} />
            {m.name} <b className="lamp-num">{pct(m.share)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Attendance({ a }: { a: MemberAnalysis["attendance"] }) {
  if (!a.checked) return <span className="lamp-cell-muted">기록 없음</span>;
  const rest = [
    a.late && `지각 ${a.late}`,
    a.absent && `결석 ${a.absent}`,
    a.excused && `사유 ${a.excused}`,
  ].filter(Boolean);
  return (
    <span
      className="lamp-num"
      title={`출석 ${a.present} / 체크된 회의 ${a.checked}`}
    >
      {a.present}/{a.checked}
      {rest.length > 0 && (
        <small className="lamp-cell-muted"> · {rest.join(" · ")}</small>
      )}
    </span>
  );
}

/** 팀원별 측정값 표 — 순위나 점수가 아니라 기록된 사실만 */
export function MemberTable({
  analysis,
  weeks,
  now,
  historyHref,
}: {
  analysis: TeamAnalysis;
  weeks: number;
  now: number;
  /** 팀원 이름을 누르면 그 팀원의 기록으로 */
  historyHref?: (userId: string) => string;
}) {
  if (!analysis.members.length)
    return (
      <div className="lamp-empty-inline">
        <p>아직 참여한 팀원이 없어요.</p>
      </div>
    );
  return (
    <div className="lamp-table-scroll">
      <table className="lamp-table prof-member-table">
        <thead>
          <tr>
            <th scope="col">팀원</th>
            <th scope="col" className="num">
              변경 기록
            </th>
            <th scope="col" className="num">
              추가 · 삭제
            </th>
            <th scope="col">변경량 비중</th>
            <th scope="col">활동한 주</th>
            <th scope="col">회의 출석</th>
            <th scope="col">활동 구성</th>
            <th scope="col">최근 변경</th>
            <th scope="col">살펴볼 점</th>
          </tr>
        </thead>
        <tbody>
          {analysis.members.map((m) => (
            <tr key={m.userId}>
              <td>
                <span className="lamp-member">
                  <Avatar name={m.name} tone={m.index % 4} size="sm" />
                  {historyHref ? (
                    <Link
                      className="lamp-row-title"
                      href={historyHref(m.userId)}
                    >
                      {m.name}
                    </Link>
                  ) : (
                    <span>{m.name}</span>
                  )}
                  {m.role === "leader" && (
                    <span className="prof-badge">팀장</span>
                  )}
                </span>
              </td>
              <td className="num lamp-num">
                {m.count}
                <small
                  className="lamp-cell-muted"
                  title={`작성자 확인 ${m.verified} · 추정 ${m.inferred}`}
                >
                  {" "}
                  (확인 {m.verified})
                </small>
              </td>
              <td className="num lamp-num">
                <span className="lamp-plus">+{m.added.toLocaleString()}</span>{" "}
                <span className="lamp-minus">
                  −{m.removed.toLocaleString()}
                </span>
              </td>
              <td>
                <span className="lamp-progress-inline">
                  <span className="lamp-bar" aria-hidden="true">
                    <span
                      style={{
                        width: pct(m.share),
                        background: memberColor(m.index),
                      }}
                    />
                  </span>
                  <span className="lamp-num">{pct(m.share)}</span>
                </span>
              </td>
              <td>
                <span className="lamp-progress-inline">
                  <span className="lamp-bar thin" aria-hidden="true">
                    <span
                      style={{
                        width: weeks ? pct(m.activeWeeks / weeks) : "0%",
                      }}
                    />
                  </span>
                  <span className="lamp-num">
                    {m.activeWeeks}/{weeks}주
                  </span>
                </span>
              </td>
              <td>
                <Attendance a={m.attendance} />
              </td>
              <td><ActivityComposition counts={m.byCategory} /></td>
              <td className="lamp-cell-muted">
                {m.lastAt ? relativeTime(m.lastAt, now) : "없음"}
              </td>
              <td>
                {m.notes.length ? (
                  <span className="prof-notes">
                    {m.notes.map((n) => (
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
  );
}
