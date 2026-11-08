"use client";
import { ActivityComposition } from "./ActivityComposition";
// 분석 탭 (GitHub Contributors 형식)
//  기간 선택 → 팀 전체 주별 기여 → 팀원별 카드(순위 · 활동 수 · 추가/삭제 글자 · 같은 축의 주별 막대)
//  집계는 src/lib/student/analytics.ts. 맨 위 AI 분석은 /api/ai-report (src/lib/analysis).
//  예전 "AI 보고서" 탭은 여기로 합쳤다 — AI 분석의 팀원별 카드가 근거 활동까지 보여 주고, 기여도 점수 표만 측정 데이터에 남겼다.
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AiReport } from "@/components/analysis/AiReport";
import { inputFromActivities } from "@/lib/analysis/rules";
import {
  bucketWeeks,
  inPeriod,
  memberStats,
  weekRange,
  type ContributionPoint,
  type Period,
  type WeekBucket,
} from "@/lib/student/analytics";
import { useStudent } from "./StudentProvider";
import { Avatar, PageHeading, relativeTime } from "./ui";
import "./analysis.css";

const PERIODS: { id: Period; label: string }[] = [
  { id: "1m", label: "최근 1개월" },
  { id: "3m", label: "최근 3개월" },
  { id: "all", label: "전체" },
];
const CATEGORY_LABEL = { document: "문서", task: "할 일", meeting: "회의", file: "파일" } as const;
// 디자인 시스템 강조색을 따른다 (대비가 낮아 최고값 라벨 · 툴팁 · 표 보기를 함께 둠)
const BAR = "var(--accent, #7561e8)";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const weekLabel = (d: string) => {
  const end = new Date(Date.parse(`${d}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  return `${md(d)} ~ ${md(end)}`;
};

type WeekDatum = Omit<WeekBucket, "points"> & { points?: number };

function WeekTooltip({ active, payload }: { active?: boolean; payload?: { payload: WeekDatum }[] }) {
  if (!active || !payload?.length) return null;
  const w = payload[0].payload;
  return (
    <div className="lamp-chart-tip">
      <strong>{weekLabel(w.start)}</strong>
      <span>
        활동 {w.count}건{w.points != null && ` · ${w.points}점`}
      </span>
    </div>
  );
}

/** 축 최댓값을 1 · 2 · 5 × 10^k 로 올림 (19 → 20, 63 → 100) */
const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
};

/** 주별 막대. 팀원 카드는 같은 max를 받아 축을 맞춘다 (비교가 공정하도록) */
export function WeeklyBars({ data, max, height, compact = false }: { data: WeekDatum[]; max: number; height: number; compact?: boolean }) {
  const peak = data.reduce((m, w, i) => (w.count > (data[m]?.count ?? 0) ? i : m), 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--line, #e6e5e1)" />
        <XAxis
          dataKey="start"
          tickFormatter={md}
          tickLine={false}
          axisLine={{ stroke: "var(--line-strong, #d4d3ce)" }}
          tick={{ fill: "var(--muted, #6b6a65)", fontSize: 12 }}
          interval="preserveStartEnd"
          minTickGap={compact ? 28 : 18}
        />
        <YAxis
          allowDecimals={false}
          domain={[0, niceMax(max)]}
          tickCount={compact ? 3 : 5}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted, #6b6a65)", fontSize: 12 }}
          width={36}
        />
        <Tooltip content={<WeekTooltip />} cursor={{ fill: "var(--surface-2, #f1f1ee)" }} />
        <Bar dataKey="count" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {/* 최고값 한 곳만 직접 표시 */}
          <LabelList
            dataKey="count"
            content={(props) => {
              const { x, y, width, value, index } = props as {
                x: number;
                y: number;
                width: number;
                value: number;
                index: number;
              };
              if (index !== peak || !value) return null;
              return (
                <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={12} fill="var(--ink-2, #3d3d3a)">
                  {value}
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Analysis() {
  const { ws, supabase } = useStudent();
  const [period, setPeriod] = useState<Period>("3m");
  const [livePoints, setLivePoints] = useState<ContributionPoint[] | null>(null);
  const [error, setError] = useState("");
  const live = ws.mode === "live";

  // 실데이터: 점수의 근거인 activity_events 전체 (대시보드용 200건 제한과 별개로 넉넉히)
  useEffect(() => {
    if (!live) return;
    let active = true;
    supabase
      .from("activity_events")
      .select("user_id, category, points, created_at, meta")
      .eq("team_id", ws.team.id)
      .order("created_at", { ascending: false })
      .limit(5000)
      .then(({ data, error: e }) => {
        if (!active) return;
        if (e) return setError(e.message);
        setLivePoints(
          (data ?? []).map((r) => {
            const m = (r.meta ?? {}) as { chars_added?: number; chars_removed?: number };
            return {
              userId: r.user_id,
              at: r.created_at,
              points: Number(r.points),
              added: Number(m.chars_added ?? 0),
              removed: Number(m.chars_removed ?? 0),
              category: r.category,
            };
          }),
        );
      });
    return () => {
      active = false;
    };
  }, [live, supabase, ws.team.id, ws.events.length]);

  // Mock: 예시 활동으로 같은 모양을 만든다
  const points: ContributionPoint[] = useMemo(
    () =>
      live
        ? (livePoints ?? [])
        : ws.activities
            .filter((a) => a.userId)
            .map((a) => ({
              userId: a.userId!,
              at: a.timestamp,
              points: 1,
              added: a.contentAfter?.replace(/\s/g, "").length ?? 0,
              removed: a.contentBefore?.replace(/\s/g, "").length ?? 0,
              category: "document" as const,
            })),
    [live, livePoints, ws.activities],
  );

  const { weeks, team, members, max, lastAt } = useMemo(() => {
    const scoped = inPeriod(points, period);
    // 팀원별 마지막 활동 시각
    const lastAt = new Map<string, string>();
    for (const p of scoped) if (!lastAt.has(p.userId) || p.at > lastAt.get(p.userId)!) lastAt.set(p.userId, p.at);
    const weeks = weekRange(scoped, period);
    const members = memberStats(scoped, ws.users.map((u) => u.id), weeks);
    const max = Math.max(1, ...members.flatMap((m) => m.weeks.map((w) => w.count)));
    return { weeks, team: bucketWeeks(scoped, weeks), members, max, lastAt };
  }, [points, period, ws.users]);

  const total = team.reduce((n, w) => n + w.count, 0);
  const tone = (id: string) => Math.max(0, ws.users.findIndex((u) => u.id === id)) % 4;
  // 예시 데이터: 같은 규칙 엔진에 넣을 입력 (AI 호출 없음)
  const mockInput = useMemo(
    () =>
      inputFromActivities({
        team: { id: ws.team.id, name: ws.team.name, track: ws.team.track, course: ws.team.courseName ? { name: ws.team.courseName } : undefined },
        members: ws.users.map((u) => ({ id: u.id, name: u.name, role: ws.team.members.find((m) => m.userId === u.id)?.role })),
        activities: ws.activities,
        meetings: ws.meetings,
        documents: ws.documents,
        period,
      }),
    [ws, period],
  );
  const name = (id: string) => ws.users.find((u) => u.id === id)?.name ?? "팀원";

  return (
    <>
      <PageHeading
        title="기여 분석"
        description="AI가 팀 기록(문서 · 구글 제안 · 할 일 · 회의 · 파일)을 근거로 팀과 팀원별 기여를 정리해요. 아래에는 근거가 되는 측정 데이터가 있어요."
        action={
          <label className="lamp-analysis-period">
            <span className="lamp-sr-only">기간</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  기간: {p.label}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {error && (
        <p className="lamp-error" role="alert">
          {error}
        </p>
      )}
      {live && livePoints === null ? (
        <div className="lamp-loading" role="status">
          <span className="lamp-spinner" />
          활동을 모으고 있어요…
        </div>
      ) : (
        <>
          {live ? (
            <AiReport mode="live" teamId={ws.team.id} period={period} toneOf={tone} />
          ) : (
            <AiReport mode="mock" teamId={ws.team.id} period={period} toneOf={tone} input={mockInput} audience="student" />
          )}
          <header className="lamp-block-title lamp-analysis-raw-title">
            <h2>측정 데이터</h2>
            <span className="lamp-cell-muted">AI 분석의 근거가 되는 집계</span>
          </header>
          <section className="lamp-card lamp-analysis-card">
            <div className="lamp-analysis-head">
              <div>
                <h2>주별 기여</h2>
                <p>
                  {weeks.length ? `${md(weeks[0])} 주부터 ${md(weeks[weeks.length - 1])} 주까지` : "기록 없음"} · 총 {total}건
                </p>
              </div>
            </div>
            <WeeklyBars data={team} max={Math.max(1, ...team.map((w) => w.count))} height={260} />
            <details className="lamp-analysis-table">
              <summary>표로 보기</summary>
              <table>
                <thead>
                  <tr>
                    <th>주</th>
                    <th>활동</th>
                    <th>점수</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((w) => (
                    <tr key={w.start}>
                      <td>{weekLabel(w.start)}</td>
                      <td>{w.count}</td>
                      <td>{w.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          {/* 기여도 점수 — 과목 가중치 · 동료평가 비교 (실데이터에만 있음) */}
          {live && ws.scores.length > 0 && <ScoreTable />}

          {/* 팀원 비교 — 측정값만. 점수 · 순위로 질을 판단하지 않는다 */}
          <section className="lamp-analysis-compare" aria-labelledby="compare-title">
            <header className="lamp-block-title">
              <h2 id="compare-title">팀원 비교</h2>
              <span className="lamp-cell-muted">{PERIODS.find((p) => p.id === period)?.label}</span>
            </header>
            <div className="lamp-table-scroll">
              <table className="lamp-table">
                <thead>
                  <tr>
                    <th scope="col">팀원</th>
                    <th scope="col" className="num">완료한 작업</th>
                    <th scope="col" className="num">문서 활동</th>
                    <th scope="col" className="num">전체 활동</th>
                    <th scope="col">활동한 주</th>
                    <th scope="col">최근 활동</th>
                    <th scope="col">활동 구성</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const activeWeeks = m.weeks.filter((w) => w.count > 0).length;
                    const completed = ws.tasks.filter((t) => t.completedBy === m.userId).length;
                    const last = lastAt.get(m.userId);
                    return (
                      <tr key={m.userId} className={m.userId === ws.me.id ? "is-me" : undefined}>
                        <td>
                          <span className="lamp-member">
                            <Avatar name={name(m.userId)} tone={ws.users.findIndex((u) => u.id === m.userId) % 4} size="sm" />
                            <span>
                              {name(m.userId)}
                              {m.userId === ws.me.id && " (나)"}
                            </span>
                          </span>
                        </td>
                        <td className="num lamp-num">{live ? completed : "—"}</td>
                        <td className="num lamp-num">{m.byCategory.document}</td>
                        <td className="num lamp-num">{m.count}</td>
                        <td>
                          <span className="lamp-progress-inline">
                            <span className="lamp-bar thin" aria-hidden="true">
                              <span style={{ width: `${weeks.length ? (activeWeeks / weeks.length) * 100 : 0}%` }} />
                            </span>
                            <span className="lamp-num">
                              {activeWeeks}/{weeks.length}주
                            </span>
                          </span>
                        </td>
                        <td className="lamp-cell-muted">{last ? relativeTime(last) : "없음"}</td>
                        <td>
                          <ActivityComposition counts={m.byCategory} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="lamp-footnote">
              모두 측정된 활동 수예요. 기여의 질이나 공정성을 판단하는 점수가 아닙니다.
              <span className="lamp-composition-legend" aria-hidden="true">
                <i className="document" /> 문서 <i className="task" /> 작업 <i className="meeting" /> 회의 <i className="file" /> 파일
              </span>
            </p>
          </section>

          <div className="lamp-analysis-members">
            {members.map((m, i) => (
              <article key={m.userId} className="lamp-card lamp-analysis-card">
                <div className="lamp-analysis-member">
                  <Avatar name={name(m.userId)} tone={ws.users.findIndex((u) => u.id === m.userId)} />
                  <div>
                    <strong>
                      {name(m.userId)}
                      {m.userId === ws.me.id && <em> (나)</em>}
                    </strong>
                    <p>
                      활동 {m.count}건 · {m.points}점 <span className="lamp-plus">{m.added.toLocaleString()}자 ++</span>{" "}
                      <span className="lamp-minus">{m.removed.toLocaleString()}자 --</span>
                    </p>
                  </div>
                  <span className="lamp-analysis-rank">#{i + 1}</span>
                </div>
                <WeeklyBars data={m.weeks} max={max} height={150} compact />
                <p className="lamp-analysis-split">
                  {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[])
                    .filter((k) => m.byCategory[k])
                    .map((k) => `${CATEGORY_LABEL[k]} ${m.byCategory[k]}`)
                    .join(" · ") || "이 기간 활동 없음"}
                </p>
              </article>
            ))}
          </div>

        </>
      )}
    </>
  );
}

/** 기여도 점수 (기존 등잔 get_team_contributions: 과목 가중치 반영, 동료평가와 불일치 표시) */
function ScoreTable() {
  const { ws } = useStudent();
  const f = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
  return (
    <section className="lamp-card lamp-score">
      <h3>기여도 점수</h3>
      <div className="lamp-table-scroll">
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>문서</th>
              <th>할 일</th>
              <th>회의</th>
              <th>파일</th>
              <th>팀 내 비중</th>
              <th>👍</th>
              <th>동료평가 비중</th>
            </tr>
          </thead>
          <tbody>
            {ws.scores.map((c) => (
              <tr key={c.user_id} className={c.mismatch ? "lamp-mismatch" : ""}>
                <td>
                  {c.name}
                  {c.user_id === ws.me.id && <em> (나)</em>}
                </td>
                <td>{f(c.document_score)}</td>
                <td>{f(c.task_score)}</td>
                <td>{f(c.meeting_score)}</td>
                <td>{f(c.file_score)}</td>
                <td>
                  <b>{f(c.share_pct)}%</b>
                </td>
                <td>{c.kudos_received}</td>
                <td>
                  {c.peer_share_pct == null ? "-" : `${f(c.peer_share_pct)}%`}
                  {c.mismatch && <span className="lamp-badge unknown"> 불일치</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lamp-help">
        과목 가중치(문서 · 할 일 · 회의 · 파일)를 반영한 점수예요. 활동 비중과 동료평가 비중이 크게 다르면 &quot;불일치&quot;로 표시돼요.
      </p>
    </section>
  );
}
