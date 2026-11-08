"use client";
// AI 기여 분석 보고서 — 학생 분석 탭 · 교수 팀원 분석 탭이 함께 쓴다.
//  live: /api/ai-report (캐시 조회 → 팀 첫 분석일 때만 자동 생성, 그 뒤엔 '다시 분석' 버튼으로만 생성, OpenRouter), mock: 같은 규칙 엔진을 화면에서 돌린다 (AI 호출 없음)
//  화면 구성: 헤드라인 → 핵심 지표 → 살펴볼 점 → 프로젝트 흐름 → 팀 제안 → 팀원별 분석 → 한계
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleAlert,
  Info,
  Lightbulb,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  Star,
} from "lucide-react";
import { CATEGORY_LABEL, PATTERN_LABEL, buildRulesReport } from "@/lib/analysis/rules";
import type { Alert, AnalysisInput, AnalysisPeriodKey, AnalysisReport, Audience, MemberReport } from "@/lib/analysis/types";
import { Avatar, relativeTime } from "@/components/student/ui";
import "./ai-report.css";

type Props = {
  teamId: string;
  period: AnalysisPeriodKey;
  /** 팀원 아바타 색 순서 */
  toneOf?: (userId: string) => number;
  /** 팀원 이름을 누르면 갈 곳 (예: 그 팀원의 기여 기록) */
  memberHref?: (userId: string) => string;
} & ({ mode: "live" } | { mode: "mock"; input: AnalysisInput; audience: Audience });

type Live = { report: AnalysisReport | null; stale: boolean; aiAvailable: boolean; hasAny?: boolean; aiError?: string };

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const SEVERITY_ICON = { critical: CircleAlert, warning: AlertTriangle, info: Info } as const;
const SEVERITY_LABEL = { critical: "주의", warning: "확인", info: "참고" } as const;
const CONFIDENCE_LABEL = { high: "근거 확실", medium: "근거 보통", low: "추정 많음" } as const;
const AI_STATUS: Record<AnalysisReport["aiStatus"], string> = {
  ok: "AI 분석",
  disabled: "규칙 분석 (AI 키 없음)",
  failed: "규칙 분석 (AI 응답 실패)",
  mock: "예시 데이터 · 규칙 분석",
};
const ERROR_TEXT: Record<string, string> = {
  unauthorized: "로그인이 필요해요.",
  forbidden: "이 팀의 분석을 볼 권한이 없어요.",
  db_error: "기록을 불러오지 못했어요.",
};

export function AiReport(props: Props) {
  const { teamId, period, toneOf = () => 0, memberHref } = props;
  // 팀 · 기간이 바뀌면 이전 결과를 쓰지 않도록 키를 함께 둔다
  const key = `${teamId}:${period}`;
  const [liveState, setLive] = useState<(Live & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorState, setErrorState] = useState({ key: "", message: "" });
  const live = liveState?.key === key ? liveState : null;
  const error = errorState.key === key ? errorState.message : "";
  const setError = useCallback((message: string) => setErrorState({ key, message }), [key]);
  const isMock = props.mode === "mock";
  const mockInput = isMock ? props.input : null;
  const mockAudience = isMock ? props.audience : "student";

  const mockReport = useMemo(
    () => (mockInput ? { ...buildRulesReport(mockInput, { audience: mockAudience }), aiStatus: "mock" as const } : null),
    [mockInput, mockAudience],
  );

  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, period }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(ERROR_TEXT[body.error] ?? "분석을 만들지 못했어요.");
      setLive({ ...body, key });
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석을 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  }, [teamId, period, key, setError]);

  useEffect(() => {
    if (isMock) return;
    let active = true;
    fetch(`/api/ai-report?teamId=${encodeURIComponent(teamId)}&period=${period}`)
      .then(async (res) => {
        const body = await res.json();
        if (!active) return;
        if (!res.ok) return setError(ERROR_TEXT[body.error] ?? "분석을 불러오지 못했어요.");
        // 저장된 보고서가 있으면 그대로 보여 준다 (AI 호출 없음). 새로 만드는 건 '다시 분석'을 눌렀을 때만.
        // 이 팀을 한 번도 분석한 적이 없을 때만 바로 만든다. 다른 기간 분석이 있으면 버튼을 보여 준다.
        if (body.report || body.hasAny) setLive({ ...body, key });
        else void generate();
      })
      .catch(() => active && setError("분석을 불러오지 못했어요."));
    return () => {
      active = false;
    };
  }, [isMock, teamId, period, key, generate, setError]);

  const report = mockReport ?? live?.report ?? null;

  if (error && !report)
    return (
      <section className="lamp-card ai-report ai-report-state" role="alert">
        <p>{error}</p>
        <button className="lamp-button" onClick={() => void generate()} disabled={busy}>
          다시 시도
        </button>
      </section>
    );
  if (!report && live && !busy)
    return (
      <section className="lamp-card ai-report ai-report-state">
        <Sparkles size={18} aria-hidden="true" />
        <div>
          <strong>이 기간의 AI 분석이 아직 없어요</strong>
          <p>버튼을 누르면 이 기간의 팀 기록으로 새로 분석해요. 보통 20~40초 걸려요.</p>
        </div>
        <button className="lamp-button" onClick={() => void generate()}>
          이 기간 분석하기
        </button>
      </section>
    );
  if (!report)
    return (
      <section className="lamp-card ai-report ai-report-state" role="status" aria-live="polite">
        <span className="lamp-spinner" />
        <div>
          <strong>AI가 팀 기록을 읽고 있어요</strong>
          <p>활동 · 문서 변경 · 할 일 · 회의 기록을 근거로 분석해요. 보통 20~40초 걸려요.</p>
        </div>
      </section>
    );

  const t = report.team;
  const professor = report.audience === "professor";
  const confirmedPct = t.totals.events ? Math.round((t.totals.verified / t.totals.events) * 100) : 0;
  return (
    <section className="ai-report" aria-labelledby="ai-report-title" aria-busy={busy}>
      {/* 헤드라인 */}
      <div className="lamp-card ai-report-hero">
        <div className="ai-report-hero-top">
          <span className={`ai-report-chip ${report.aiStatus === "ok" ? "is-ai" : ""}`}>
            <Sparkles size={14} aria-hidden="true" /> {AI_STATUS[report.aiStatus]}
          </span>
          <span className="ai-report-meta">
            {md(report.period.from)} ~ {md(report.period.to)} · {relativeTime(report.generatedAt)} 생성
            {live?.stale && <b className="ai-report-stale"> · 새 활동 있음</b>}
          </span>
          {!isMock && (
            <button className="lamp-button ai-report-refresh" onClick={() => void generate()} disabled={busy}>
              <RefreshCw size={14} className={busy ? "is-spinning" : undefined} aria-hidden="true" />
              {busy ? "분석 중…" : "다시 분석"}
            </button>
          )}
        </div>
        <h2 id="ai-report-title">{t.headline}</h2>
        <p>{t.summary}</p>
        {error && (
          <p className="lamp-error" role="alert">
            {error}
          </p>
        )}
        <dl className="ai-report-kpis">
          <div>
            <dt>활동한 팀원</dt>
            <dd>
              {t.balance.activeMembers}
              <small>/{t.balance.totalMembers}명</small>
            </dd>
          </div>
          <div>
            <dt>최대 비중</dt>
            <dd>
              {t.balance.topSharePct}
              <small>%</small>
            </dd>
          </div>
          <div>
            <dt title="활동 수가 팀원 사이에 얼마나 고르게 나뉘었는지 (100 = 완전히 고름)">균형 지수</dt>
            <dd>
              {Math.round((1 - t.balance.gini) * 100)}
              <small>/100</small>
            </dd>
          </div>
          <div>
            <dt>작성자 확정</dt>
            <dd>
              {confirmedPct}
              <small>% · {t.totals.events}건</small>
            </dd>
          </div>
          <div>
            <dt>활동한 주</dt>
            <dd>
              {t.totals.activeWeeks}
              <small>/{t.totals.weeks}주</small>
            </dd>
          </div>
        </dl>
      </div>

      <div className="ai-report-grid">
        {/* 살펴볼 점 */}
        <div className="lamp-card ai-report-block">
          <h3>살펴볼 점</h3>
          {t.alerts.length ? (
            <ul className="ai-report-alerts">
              {t.alerts.map((a, i) => (
                <AlertItem key={i} alert={a} />
              ))}
            </ul>
          ) : (
            <p className="lamp-cell-muted">기록에서 눈에 띄는 쏠림이나 공백은 없어요.</p>
          )}
        </div>
        {/* 팀 제안 */}
        <div className="lamp-card ai-report-block">
          <h3>{professor ? "지도 포인트" : "팀에 제안"}</h3>
          <ul className="ai-report-list">
            {t.recommendations.map((r, i) => (
              <li key={i}>
                <Lightbulb size={14} aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 프로젝트 흐름 */}
      {t.phases.length > 0 && (
        <div className="lamp-card ai-report-block">
          <h3>프로젝트 흐름</h3>
          <ol className="ai-report-phases">
            {t.phases.map((p) => (
              <li key={`${p.from}-${p.title}`}>
                <span className="ai-report-phase-date">
                  {md(p.from)}
                  {p.to !== p.from && ` ~ ${md(p.to)}`} 주
                </span>
                <strong>{p.title}</strong>
                <p>{p.description}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 팀원별 */}
      <header className="lamp-block-title ai-report-members-title">
        <h3>{report.aiStatus === "ok" ? "팀원별 AI 분석" : "팀원별 분석"}</h3>
        <span className="lamp-cell-muted">비중은 활동 수 · 변경 글자 · 과목 가중 점수 기준</span>
      </header>
      <div className="ai-report-members">
        {report.members.map((m) => (
          <MemberCard
            key={m.userId}
            m={m}
            report={report}
            tone={toneOf(m.userId)}
            href={memberHref?.(m.userId)}
            professor={professor}
          />
        ))}
      </div>

      <ul className="ai-report-limits">
        {report.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
        <li>생성: {report.model}</li>
      </ul>
    </section>
  );
}

function AlertItem({ alert }: { alert: Alert }) {
  const Icon = SEVERITY_ICON[alert.severity];
  return (
    <li className={`ai-report-alert is-${alert.severity}`}>
      <Icon size={16} aria-hidden="true" />
      <span>
        <b>{SEVERITY_LABEL[alert.severity]}</b> {alert.message}
      </span>
    </li>
  );
}

function ShareRow({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div className="ai-report-share">
      <span>{label}</span>
      <span className="lamp-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <b className="lamp-num">{value}%</b>
    </div>
  );
}

function MemberCard({
  m,
  report,
  tone,
  href,
  professor,
}: {
  m: MemberReport;
  report: AnalysisReport;
  tone: number;
  href?: string;
  professor: boolean;
}) {
  const cats = (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).filter((c) => m.metrics.byCategory[c]);
  return (
    <article className="lamp-card ai-report-member">
      <header>
        <Avatar name={m.name} tone={tone} />
        <div>
          <strong>{href ? <a href={href}>{m.name}</a> : m.name}</strong>
          <span className="lamp-cell-muted">{m.role}</span>
        </div>
        {(m.weeks.length >= 2 || m.pattern === "inactive") && (
          <span className={`ai-report-pattern is-${m.pattern}`} title={m.patternNote}>
            {PATTERN_LABEL[m.pattern]}
          </span>
        )}
        {m.metrics.events > 0 && (
          <span className={`ai-report-confidence is-${m.confidence}`}>{CONFIDENCE_LABEL[m.confidence]}</span>
        )}
      </header>
      <p className="ai-report-summary">{m.summary}</p>

      <div className="ai-report-shares">
        <ShareRow label="활동" value={m.share.activityPct} />
        <ShareRow label="변경 글자" value={m.share.volumePct} />
        <ShareRow label="가중 점수" value={m.share.scorePct} />
      </div>
      <p className="ai-report-facts">
        활동 {m.metrics.events}건 (확정 {m.metrics.verified} · 추정 {m.metrics.inferred})
        {cats.length > 0 && ` · ${cats.map((c) => `${CATEGORY_LABEL[c]} ${m.metrics.byCategory[c]}`).join(" · ")}`}
        {m.metrics.meetingsChecked > 0 && ` · 회의 ${m.metrics.meetingsPresent}/${m.metrics.meetingsChecked}`}
        {` · ${m.patternNote}`}
        {m.metrics.lastAt && ` · 최근 ${relativeTime(m.metrics.lastAt)}`}
      </p>
      <Spark weeks={m.weeks} />

      {m.highlights.length > 0 && (
        <div className="ai-report-section">
          <h4>주요 기여</h4>
          <ol className="ai-report-highlights">
            {m.highlights.map((h, i) => (
              <li key={`${i}-${h.label}`}>
                <details>
                  <summary>
                    {h.label}
                    <small className="lamp-cell-muted"> 근거 {h.evidenceIds.length}건</small>
                  </summary>
                  <ul>
                    {h.evidenceIds.map((id) => {
                      const e = report.evidence[id];
                      if (!e) return null;
                      return (
                        <li key={id}>
                          <span className={`ai-report-attr is-${e.attribution}`}>{e.attribution === "verified" ? "확정" : "추정"}</span>{" "}
                          {e.label} <span className="lamp-cell-muted">· {md(e.at.slice(0, 10))}</span>
                          {e.excerpt && <q>{e.excerpt}</q>}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
      {m.strengths.length > 0 && (
        <div className="ai-report-section">
          <h4>잘한 점</h4>
          <ul className="ai-report-list">
            {m.strengths.map((s, i) => (
              <li key={i}>
                <Star size={14} aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.suggestions.length > 0 && (
        <div className="ai-report-section">
          <h4>{professor ? "확인해볼 점" : "다음에 해볼 일"}</h4>
          <ul className="ai-report-list">
            {m.suggestions.map((s, i) => (
              <li key={i}>
                <Lightbulb size={14} aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.questions.length > 0 && (
        <div className="ai-report-section">
          <h4>면담 질문</h4>
          <ul className="ai-report-list">
            {m.questions.map((q, i) => (
              <li key={i}>
                <MessageCircleQuestion size={14} aria-hidden="true" />
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.flags.length > 0 && (
        <ul className="ai-report-alerts compact">
          {m.flags.map((f, i) => (
            <AlertItem key={i} alert={f} />
          ))}
        </ul>
      )}
    </article>
  );
}

/** 주별 활동 미니 막대 */
function Spark({ weeks }: { weeks: { start: string; count: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div
      className="ai-report-spark"
      role="img"
      aria-label={`주별 활동: ${weeks.map((w) => `${md(w.start)} ${w.count}건`).join(", ")}`}
    >
      {weeks.map((w) => (
        <span key={w.start} title={`${md(w.start)} 주 · ${w.count}건`} style={{ height: `${Math.max(4, (w.count / max) * 100)}%` }} className={w.count ? "" : "zero"} />
      ))}
    </div>
  );
}
