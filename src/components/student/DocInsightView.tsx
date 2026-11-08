"use client";
// 문서 미리보기 — 왼쪽: 본문에 작성자별 형광펜 / 오른쪽: 문서 통계 · 분석
//  단색 = 작성자 확인(제안) 또는 편집자 1명, 줄무늬 = 여러 명이 함께 편집한 구간(편집 시간 비율 추정),
//  형광펜 없음 = 기록 이전(연결 전에 있던 내용)
import { useMemo, useState, type CSSProperties } from "react";
import { ExternalLink, X } from "lucide-react";
import type { DocInsight, InsightSource } from "@/lib/google/insight";
import { formatTime, relativeTime } from "./ui";
import { DocumentStartLink } from "./DocumentGuide";

const PALETTE = 6;
const hl = (a: number) => `var(--hl-${(a % PALETTE) + 1})`;
const dot = (a: number) => `var(--hl-${(a % PALETTE) + 1}-dot)`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const CONFIDENCE_LABEL: Record<InsightSource["confidence"], string> = {
  confirmed: "작성자 확인 (제안)",
  single: "편집자 1명",
  shared: "공동 편집 · 추정",
  fallback: "마지막 수정자 기준 · 추정",
};

type Piece = { text: string; src: string | null; start: number };

/** 구간을 줄 단위로 끊어 문단 배열로 */
function paragraphs(insight: DocInsight): Piece[][] {
  const out: Piece[][] = [[]];
  for (const seg of insight.segments) {
    const parts = insight.text.slice(seg.start, seg.end).split("\n");
    let offset = seg.start;
    parts.forEach((part, i) => {
      if (i > 0) out.push([]);
      if (part) out.at(-1)!.push({ text: part, src: seg.src, start: offset });
      offset += part.length + 1;
    });
  }
  return out;
}

const isHeading = (line: string) => {
  const t = line.trim();
  return t.length > 0 && t.length <= 30 && !/[.。!?다]$/.test(t);
};

function markStyle(source: InsightSource | undefined): CSSProperties | undefined {
  if (!source) return undefined;
  const authors = [...source.authors].sort((x, y) => y.share - x.share);
  if (authors.length === 1) return { background: hl(authors[0].a) };
  const stops = authors
    .slice(0, 3)
    .map(({ a }, i) => `${hl(a)} ${i * 7}px ${(i + 1) * 7}px`)
    .join(", ");
  return {
    background: `repeating-linear-gradient(135deg, ${stops})`,
  };
}

export function DocInsightView({
  insight,
  loading,
  error,
  onClose,
  readOnly = false,
}: {
  insight: DocInsight | null;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
  /** 교수 조회 — 작성 안내(제안 모드) 없이 바로 원본을 연다 */
  readOnly?: boolean;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ src: string | null; text: string } | null>(null);
  const [now] = useState(() => Date.now());

  const paras = useMemo(() => (insight ? paragraphs(insight) : []), [insight]);

  if (!insight) {
    return (
      <section className="lamp-section-block lamp-insight" aria-busy={loading}>
        <p className="lamp-muted lamp-insight-empty">
          {error ?? (loading ? "문서 미리보기를 불러오는 중…" : "미리볼 문서를 골라 주세요.")}
        </p>
      </section>
    );
  }

  const { authors, sources, stats } = insight;
  const name = (a: number) => authors[a]?.name ?? "?";
  const top = stats.perAuthor.filter((p) => p.current > 0 || p.added > 0);
  const maxDay = Math.max(1, ...stats.daily.map((d) => d.byAuthor.reduce((n, v) => n + v, 0)));
  const covTotal = stats.chars || 1;
  const pickedSource = picked?.src ? sources[picked.src] : undefined;

  // 분석 요약 문장
  const notes: string[] = [];
  if (top[0] && top[0].currentShare > 0) {
    notes.push(`현재 본문의 ${pct(top[0].currentShare)}는 ${name(top[0].a)} 님이 쓴 글이에요.`);
  }
  if (stats.coverage.unknown / covTotal > 0.5) {
    notes.push("본문의 절반 이상이 연결 전에 있던 내용이라 작성자를 알 수 없어요.");
  }
  if (stats.coverage.estimated / covTotal > 0.3) {
    notes.push("함께 편집한 구간이 많아 추정 비율이 높아요. 제안 모드로 쓰면 작성자가 정확히 남아요.");
  }
  const edited = top.filter((p) => p.survival !== null && p.survival < 0.6 && p.added >= 30);
  for (const p of edited.slice(0, 1)) {
    notes.push(`${name(p.a)} 님이 쓴 글 중 ${pct(p.survival!)}만 남아 있어요 — 다른 팀원이 많이 다듬었을 수 있어요.`);
  }
  const quiet = top.filter((p) => p.lastAt && now - Date.parse(p.lastAt) > 3 * 86_400_000);
  if (quiet.length) notes.push(`${quiet.map((p) => name(p.a)).join(", ")} 님은 최근 3일 동안 수정이 없어요.`);
  const lastAll = stats.daily.slice(-3).every((d) => d.byAuthor.every((v) => v === 0));
  if (lastAll && stats.edits + stats.suggestions > 0) notes.push("최근 3일간 문서에 기록된 수정이 없어요.");

  return (
    <section className="lamp-section-block lamp-insight" aria-labelledby="insight-title">
      <header className="lamp-insight-head">
        <div>
          <h2 id="insight-title">{insight.doc.title}</h2>
          <p className="lamp-docs-meta">
            문서 미리보기 ·{" "}
            {stats.trackedSince ? `${formatTime(stats.trackedSince)}부터 기록` : "기록 전"}
            {insight.doc.last_synced_at && ` · 동기화 ${relativeTime(insight.doc.last_synced_at, now)}`}
          </p>
        </div>
        <div className="lamp-actions">
          {insight.doc.web_url && (
            <DocumentStartLink className="lamp-button secondary" url={insight.doc.web_url} title={insight.doc.title} requireSuggestion={!readOnly && insight.doc.mime_type === "application/vnd.google-apps.document"}>
              <ExternalLink size={14} /> Google에서 열기
            </DocumentStartLink>
          )}
          {onClose && (
            <button className="lamp-icon-button" onClick={onClose} aria-label="미리보기 닫기">
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="lamp-insight-grid">
        {/* ---------- 왼쪽: 미리보기 ---------- */}
        <div className="lamp-insight-preview">
          <div className="lamp-insight-legend" role="group" aria-label="작성자별로 보기">
            <button className={focus === null ? "is-on" : undefined} onClick={() => setFocus(null)}>
              전체
            </button>
            {top.map((p) => (
              <button
                key={p.a}
                className={focus === p.a ? "is-on" : undefined}
                onClick={() => setFocus(focus === p.a ? null : p.a)}
                aria-pressed={focus === p.a}
              >
                <i style={{ background: dot(p.a) }} aria-hidden="true" />
                {name(p.a)}
              </button>
            ))}
            <span className="lamp-insight-key">
              <i className="is-striped" aria-hidden="true" /> 공동·추정
              <i className="is-none" aria-hidden="true" /> 기록 이전
            </span>
          </div>

          <article className={`lamp-insight-paper${focus !== null ? " is-focused" : ""}`}>
            {insight.text.trim() === "" ? (
              <p className="lamp-muted">본문이 비어 있거나 아직 동기화되지 않았어요.</p>
            ) : (
              paras.map((pieces, i) => {
                const line = pieces.map((p) => p.text).join("");
                if (!line.trim()) return <br key={i} />;
                const Tag = isHeading(line) ? "h3" : "p";
                return (
                  <Tag key={i}>
                    {pieces.map((piece) => {
                      const source = piece.src ? sources[piece.src] : undefined;
                      if (!source) return <span key={piece.start}>{piece.text}</span>;
                      const mine = focus === null || source.authors.some((x) => x.a === focus);
                      const who = [...source.authors]
                        .sort((x, y) => y.share - x.share)
                        .map((x) => (source.authors.length > 1 ? `${name(x.a)} ${pct(x.share)}` : name(x.a)))
                        .join(", ");
                      return (
                        <mark
                          key={piece.start}
                          style={mine ? markStyle(source) : undefined}
                          className={`${mine ? "" : "is-dim"}${picked?.src === piece.src ? " is-picked" : ""}`}
                          title={`${who} · ${CONFIDENCE_LABEL[source.confidence]} · ${formatTime(source.at)}`}
                          tabIndex={0}
                          onClick={() => setPicked({ src: piece.src, text: piece.text })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setPicked({ src: piece.src, text: piece.text });
                            }
                          }}
                        >
                          {piece.text}
                        </mark>
                      );
                    })}
                  </Tag>
                );
              })
            )}
          </article>
          <p className="lamp-footnote">
            형광펜을 누르면 오른쪽에 그 부분을 쓴 사람과 시각이 나와요. 서식(표 · 이미지)은 빼고 글자만 보여줘요.
          </p>
        </div>

        {/* ---------- 오른쪽: 통계 · 분석 ---------- */}
        <aside className="lamp-insight-side" aria-label="문서 통계와 분석">
          {pickedSource && picked && (
            <div className="lamp-insight-card is-picked" role="status">
              <div className="lamp-insight-card-title">
                <h3>선택한 부분</h3>
                <button className="lamp-text-button" onClick={() => setPicked(null)}>
                  닫기
                </button>
              </div>
              <blockquote>{picked.text.length > 120 ? `${picked.text.slice(0, 120)}…` : picked.text}</blockquote>
              <ul className="lamp-insight-people">
                {[...pickedSource.authors]
                  .sort((x, y) => y.share - x.share)
                  .map((x) => (
                    <li key={x.a}>
                      <i style={{ background: dot(x.a) }} aria-hidden="true" />
                      {name(x.a)}
                      {pickedSource.authors.length > 1 && <b className="lamp-num">{pct(x.share)}</b>}
                    </li>
                  ))}
              </ul>
              <p className="lamp-docs-meta">
                {CONFIDENCE_LABEL[pickedSource.confidence]} ·{" "}
                {pickedSource.from
                  ? `${formatTime(pickedSource.from)} ~ ${formatTime(pickedSource.at)}`
                  : formatTime(pickedSource.at)}
              </p>
            </div>
          )}

          <dl className="lamp-insight-overview">
            <div>
              <dt>글자</dt>
              <dd className="lamp-num">{stats.chars.toLocaleString()}</dd>
            </div>
            <div>
              <dt>단어</dt>
              <dd className="lamp-num">{stats.words.toLocaleString()}</dd>
            </div>
            <div>
              <dt>문단</dt>
              <dd className="lamp-num">{stats.paragraphs}</dd>
            </div>
            <div>
              <dt>수정 · 제안</dt>
              <dd className="lamp-num">
                {stats.edits} · {stats.suggestions}
              </dd>
            </div>
          </dl>

          <div className="lamp-insight-card">
            <h3>지금 본문에 남은 기여</h3>
            {top.length === 0 ? (
              <p className="lamp-docs-meta">아직 기록된 수정이 없어요.</p>
            ) : (
              <>
                <div className="lamp-docs-bar" role="img" aria-label={top.map((p) => `${name(p.a)} ${pct(p.currentShare)}`).join(", ")}>
                  {top.map((p) => (
                    <span key={p.a} style={{ flexGrow: p.current, background: dot(p.a) }} />
                  ))}
                  {stats.coverage.unknown > 0 && (
                    <span style={{ flexGrow: stats.coverage.unknown, background: "var(--line-strong)" }} />
                  )}
                </div>
                <table className="lamp-insight-table">
                  <thead>
                    <tr>
                      <th scope="col">팀원</th>
                      <th scope="col">본문</th>
                      <th scope="col" title="가장 많이 쓴 문단 수">주도 문단</th>
                      <th scope="col" title="쓴 글자 중 지금까지 남은 비율">남은 비율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((p) => (
                      <tr key={p.a}>
                        <th scope="row">
                          <span>
                            <i style={{ background: dot(p.a) }} aria-hidden="true" />
                            {name(p.a)}
                          </span>
                        </th>
                        <td className="lamp-num">
                          {pct(p.currentShare)}
                          <small>{p.current.toLocaleString()}자</small>
                        </td>
                        <td className="lamp-num">{p.paragraphsLed}</td>
                        <td className="lamp-num">{p.survival === null ? "—" : pct(p.survival)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div className="lamp-insight-card">
            <h3>작성자 확인 정도</h3>
            <div className="lamp-docs-bar" role="img" aria-label="확인, 추정, 기록 이전 비율">
              <span style={{ flexGrow: stats.coverage.confirmed, background: "var(--success-dot)" }} />
              <span style={{ flexGrow: stats.coverage.estimated, background: "var(--warning-dot)" }} />
              <span style={{ flexGrow: stats.coverage.unknown, background: "var(--line-strong)" }} />
            </div>
            <ul className="lamp-docs-legend">
              <li>
                <i style={{ background: "var(--success-dot)" }} aria-hidden="true" />
                확인 <b className="lamp-num">{pct(stats.coverage.confirmed / covTotal)}</b>
              </li>
              <li>
                <i style={{ background: "var(--warning-dot)" }} aria-hidden="true" />
                추정 <b className="lamp-num">{pct(stats.coverage.estimated / covTotal)}</b>
              </li>
              <li>
                <i style={{ background: "var(--line-strong)" }} aria-hidden="true" />
                기록 이전 <b className="lamp-num">{pct(stats.coverage.unknown / covTotal)}</b>
              </li>
            </ul>
          </div>

          <div className="lamp-insight-card">
            <h3>최근 14일 작성량</h3>
            <div className="lamp-insight-days" role="img" aria-label="최근 14일 동안 날짜별로 추가한 글자 수">
              {stats.daily.map((d) => {
                const total = d.byAuthor.reduce((n, v) => n + v, 0);
                return (
                  <div key={d.day} title={`${d.day.slice(5)} · ${total}자`}>
                    <div className="lamp-insight-col" style={{ height: `${(total / maxDay) * 100}%` }}>
                      {d.byAuthor.map((v, a) =>
                        v > 0 ? <span key={a} style={{ flexGrow: v, background: dot(a) }} /> : null,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="lamp-insight-days-axis">
              <span>{stats.daily[0]?.day.slice(5).replace("-", "/")}</span>
              <span>오늘</span>
            </div>
          </div>

          {notes.length > 0 && (
            <div className="lamp-insight-card">
              <h3>분석</h3>
              <ul className="lamp-insight-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="lamp-footnote">글자 수는 측정값이에요. 기여의 질을 뜻하지 않아요.</p>
        </aside>
      </div>
    </section>
  );
}
