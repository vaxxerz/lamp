"use client";
// 문서 탭 — 팀이 함께 쓰는 Google 문서 · 슬라이드 · 시트
//  실데이터: 한양 구글 로그인 때 드라이브가 함께 연결되므로 바로 "+ 문서 연결" → Picker
//            (데모 계정 · 예전에 로그인한 사람은 "한양 구글 계정으로 연결"로 한 번 연결)
//  Mock: 예시 문서 + 링크만 저장하는 폼
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  FilePlus2,
  ExternalLink,
  LogIn,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  creditsOf,
  groupShareIssues,
  suggestionAuthor,
  useGoogleDocs,
  type NewDocKind,
} from "@/components/google/useGoogleDocs";
import { useStudent } from "./StudentProvider";
import {
  Avatar,
  DOC_TYPE_LABEL,
  DocumentIcon,
  PageHeading,
  SourceLink,
  StatusBadge,
  relativeTime,
} from "./ui";
import type { ConnectedDocument } from "@/lib/student/types";
import { DocumentReminder, DocumentStartLink } from "./DocumentGuide";

const CONNECT_HREF = `/api/google/connect?returnTo=${encodeURIComponent("/lamp/documents")}`;

/** 기여 비율 막대에 쓰는 팀원별 색 (토큰 기반, 4색 순환) */
const TONES = [
  "var(--accent)",
  "var(--success-dot)",
  "var(--warning-dot)",
  "var(--muted)",
];

function HowItWorks() {
  return (
    <section className="lamp-section-block" aria-labelledby="docs-how">
      <header className="lamp-block-title">
        <h2 id="docs-how">기여가 정확히 남는 방법</h2>
      </header>
      <ol className="lamp-docs-steps">
        <li>
          <b>제안 모드로 쓰기</b>
          <span>
            구글 문서 오른쪽 위 메뉴에서 ‘제안’을 선택하고, 작성 중에는 모드를 바꾸지 마세요.
          </span>
        </li>
        <li>
          <b>몇 초 뒤 자동 수락</b>
          <span>Lamp가 기록한 뒤 바로 수락해서 문서는 깔끔하게 유지돼요.</span>
        </li>
        <li>
          <b>작성자 확인으로 기록</b>
          <span>
            직접 수정은 편집 시간으로 나눈 ‘추정’, 제안은 추정 없이
            ‘확인’이에요.
          </span>
        </li>
      </ol>
    </section>
  );
}

/** 문서 분석 화면으로 들어가는 링크 (행 전체가 눌리도록 stretched) */
function OpenLink({ id, children }: { id: string; children: string }) {
  return (
    <Link className="lamp-docs-open" href={`/lamp/documents/${id}`}>
      {children}
    </Link>
  );
}

const NEW_DOC_KINDS: { kind: NewDocKind; label: string }[] = [
  { kind: "document", label: "문서" },
  { kind: "presentation", label: "슬라이드" },
  { kind: "spreadsheet", label: "시트" },
];

/** 램프에서 바로 새 구글 문서 만들기 — 만든 사람 드라이브에 생성되고 팀원 전원에게 편집 권한 */
function NewDocForm({
  busy,
  onCreate,
  onClose,
}: {
  busy: boolean;
  onCreate: (kind: NewDocKind, title: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<NewDocKind>("document");
  const [title, setTitle] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    // 팝업 차단을 피하려고 클릭 시점에 창을 먼저 열고, 만들어지면 주소를 넣는다
    const win = window.open("", "_blank");
    const url = await onCreate(kind, title.trim());
    if (url && win) win.location.href = url;
    else win?.close();
    if (url) onClose();
  }
  return (
    <form className="lamp-docs-account lamp-docs-new" onSubmit={submit}>
      <label className="lamp-field-label" htmlFor="new-doc-title">
        새 구글 파일
      </label>
      <div className="lamp-docs-new-kinds" role="radiogroup" aria-label="종류">
        {NEW_DOC_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={kind === k.kind}
            className={`lamp-button secondary${kind === k.kind ? " is-active" : ""}`}
            onClick={() => setKind(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="lamp-input-row">
        <input
          id="new-doc-title"
          className="lamp-input"
          required
          maxLength={200}
          placeholder="예: 최종 보고서"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="lamp-button" disabled={busy || !title.trim() || (kind === "document" && !acknowledged)}>
          {busy ? "만드는 중…" : "만들기"}
        </button>
        <button type="button" className="lamp-text-button" onClick={onClose}>
          취소
        </button>
      </div>
      {kind === "document" && <><DocumentReminder /><label className="lamp-guide-acknowledgment"><input type="checkbox" required checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> 문서를 열면 ‘제안’을 선택하고, 작성 중에는 모드를 바꾸지 않을게요.</label></>}
      <p className="lamp-help">
        내 드라이브에 만들어지고, 팀원 모두에게 편집 권한이 자동으로 공유돼요.
      </p>
    </form>
  );
}

/** 팀원 자동 공유가 실패한 문서 안내 */
function ShareIssues({ issues }: { issues: ReturnType<typeof groupShareIssues> }) {
  if (issues.length === 0) return null;
  return (
    <div className="lamp-docs-share-issues" role="alert">
      <p className="lamp-docs-share-issues-title">
        <AlertTriangle size={16} /> 일부 팀원이 구글 문서에 접근하지 못하고 있어요
      </p>
      <ul>
        {issues.map((i) => (
          <li key={`${i.docId}:${i.reason}`}>
            <b>{i.title}</b>
            {i.names.length > 0 && <> · {i.names.join(", ")}</>}
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveDocuments() {
  const { ws, reload } = useStudent();
  const g = useGoogleDocs(ws.team.id);
  const [now] = useState(() => Date.now());
  const connected = !!g.myGoogle;
  const byId = new Map(ws.documents.map((d) => [d.id, d]));
  const lastSync = g.docs
    .map((d) => d.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const unconnected = g.members.filter((m) => !m.connected);
  const shareIssues = groupShareIssues(g.shareIssues);
  const [creating, setCreating] = useState(false);

  async function create(kind: NewDocKind, title: string) {
    const url = await g.createDoc(kind, title);
    await reload();
    return url;
  }
  async function add() {
    await g.addDoc();
    await reload();
  }
  async function syncNow() {
    await g.sync(true);
    await reload();
  }

  return (
    <>
      <PageHeading
        title="문서"
        description="팀이 함께 쓰는 Google 문서 · 슬라이드 · 시트를 연결하면, 누가 무엇을 썼는지 자동으로 모여요."
        action={
          <div className="lamp-actions">
            <button
              className="lamp-button secondary"
              onClick={() => void syncNow()}
              disabled={!!g.busy || g.docs.length === 0}
            >
              <RefreshCw
                size={14}
                className={g.busy === "sync" ? "lamp-spin" : undefined}
              />
              {g.busy === "sync" ? "동기화 중…" : "동기화"}
            </button>
            {connected ? (
              <>
                <button
                  className="lamp-button secondary"
                  onClick={() => setCreating((v) => !v)}
                  disabled={!!g.busy}
                  aria-expanded={creating}
                >
                  <FilePlus2 size={14} /> 새 문서
                </button>
                <button
                  className="lamp-button"
                  onClick={() => void add()}
                  disabled={!!g.busy}
                >
                  <Plus size={14} />
                  {g.busy === "add" ? "여는 중…" : "문서 연결"}
                </button>
              </>
            ) : (
              <a className="lamp-button" href={CONNECT_HREF}>
                <Plus size={14} /> 문서 연결
              </a>
            )}
          </div>
        }
      />

      {/* 내 구글 연결 */}
      <div className={`lamp-docs-account${connected ? " is-on" : ""}`}>
        <span className="lamp-docs-account-dot" aria-hidden="true" />
        {g.myGoogle === undefined ? (
          <p>구글 연결 상태를 확인하는 중…</p>
        ) : connected ? (
          <>
            <p>
              <b>Google 드라이브 연결됨</b> · {g.myGoogle}
              <span className="lamp-muted">
                {" "}
                — 문서 연결에서 고른 파일만 읽어요
              </span>
            </p>
            <button
              className="lamp-text-button"
              onClick={() => void g.disconnect()}
            >
              연결 해제
            </button>
          </>
        ) : (
          <>
            <p>
              <b>드라이브가 아직 연결되지 않았어요.</b> 한양 구글 계정으로 한
              번만 연결하면 다음부터는 로그인과 함께 연결돼요.
            </p>
            <a className="lamp-button secondary" href={CONNECT_HREF}>
              한양 구글 계정으로 연결
            </a>
          </>
        )}
      </div>

      {creating && connected && (
        <NewDocForm
          busy={g.busy === "create"}
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      )}

      {g.message && (
        <p className="lamp-docs-message" role="status">
          <CheckCircle2 size={16} />
          {g.message}
        </p>
      )}

      <ShareIssues issues={shareIssues} />

      <dl className="lamp-metrics">
        <div>
          <dt>연결된 문서</dt>
          <dd className="lamp-num">{g.docs.length}</dd>
          <p>Docs · Slides · Sheets</p>
        </div>
        <div>
          <dt>작성자 확인 (제안)</dt>
          <dd className="lamp-num">{g.suggestions.length}</dd>
          <p>제안 모드로 쓴 수정</p>
        </div>
        <div>
          <dt>직접 수정</dt>
          <dd className="lamp-num">{g.revisions.length}</dd>
          <p>편집 시간으로 나눈 추정</p>
        </div>
        <div>
          <dt>마지막 동기화</dt>
          <dd className="lamp-num lamp-docs-sync">
            {lastSync ? relativeTime(lastSync, now) : "—"}
          </dd>
          <p>열려 있는 동안 90초마다</p>
        </div>
      </dl>

      <div className="lamp-dash-layout">
        <div className="lamp-dash-main">
          <section className="lamp-section-block" aria-labelledby="docs-list">
            <header className="lamp-block-title">
              <h2 id="docs-list">
                연결된 문서 <span className="lamp-count">{g.docs.length}</span>
              </h2>
            </header>
            {g.docs.length === 0 ? (
              <div className="lamp-docs-empty">
                <DocumentIcon type="docs" />
                <h3>아직 연결된 문서가 없어요</h3>
                <p>
                  보고서 · 발표자료처럼 팀이 함께 쓰는 파일을 하나 골라 연결해
                  보세요.
                </p>
                {connected ? (
                  <button
                    className="lamp-button"
                    onClick={() => void add()}
                    disabled={!!g.busy}
                  >
                    <Plus size={14} /> 문서 연결
                  </button>
                ) : (
                  <a className="lamp-button" href={CONNECT_HREF}>
                    한양 구글 계정으로 연결
                  </a>
                )}
              </div>
            ) : (
              <ul className="lamp-docs-list">
                {g.docs.map((doc) => {
                  const view: ConnectedDocument | undefined = byId.get(doc.id);
                  const revs = g.revisions.filter(
                    (r) => r.external_doc_id === doc.id,
                  );
                  const sugs = g.suggestions.filter(
                    (x) => x.external_doc_id === doc.id,
                  );
                  const chars = new Map<string, number>();
                  const add = (name: string, n: number) =>
                    chars.set(name, (chars.get(name) ?? 0) + n);
                  revs.forEach((r) =>
                    creditsOf(r).forEach((c) => add(c.name, c.added)),
                  );
                  sugs.forEach((x) => add(suggestionAuthor(x), x.chars_added));
                  const authors = [...chars]
                    .filter(([, n]) => n > 0)
                    .sort((a, b) => b[1] - a[1]);
                  const total = authors.reduce((n, [, c]) => n + c, 0);
                  const type = view?.type ?? "docs";
                  return (
                    <li
                      key={doc.id}
                      className="lamp-docs-row is-link"
                    >
                      <DocumentIcon type={type} />
                      <div className="lamp-docs-main">
                        <div className="lamp-docs-title">
                          <h3>
                            <OpenLink id={doc.id}>{doc.title}</OpenLink>
                          </h3>
                          {doc.web_url && (
                            <DocumentStartLink url={doc.web_url} title={doc.title} requireSuggestion={type === "docs"}>
                              <ExternalLink size={14} />
                            </DocumentStartLink>
                          )}
                        </div>
                        <p className="lamp-docs-meta">
                          Google {DOC_TYPE_LABEL[type]} · 제안 {sugs.length}건 ·
                          직접 수정 {revs.length}건 ·{" "}
                          {doc.last_synced_at
                            ? `동기화 ${relativeTime(doc.last_synced_at, now)}`
                            : "동기화 전"}
                        </p>
                        {total > 0 ? (
                          <>
                            <div
                              className="lamp-docs-bar"
                              role="img"
                              aria-label={authors
                                .map(([n, c]) => `${n} ${c}자`)
                                .join(", ")}
                            >
                              {authors.map(([name, c], i) => (
                                <span
                                  key={name}
                                  style={{
                                    flexGrow: c,
                                    background: TONES[i % TONES.length],
                                  }}
                                />
                              ))}
                            </div>
                            <ul className="lamp-docs-legend">
                              {authors.slice(0, 4).map(([name, c], i) => (
                                <li key={name}>
                                  <i
                                    style={{
                                      background: TONES[i % TONES.length],
                                    }}
                                    aria-hidden="true"
                                  />
                                  {name}{" "}
                                  <b className="lamp-num">
                                    {Math.round((c / total) * 100)}%
                                  </b>
                                </li>
                              ))}
                              {authors.length > 4 && (
                                <li>외 {authors.length - 4}명</li>
                              )}
                            </ul>
                          </>
                        ) : (
                          <p className="lamp-docs-meta">
                            아직 기록된 수정이 없어요.
                          </p>
                        )}
                      </div>
                      <ChevronRight
                        className="lamp-docs-chevron"
                        size={18}
                        aria-hidden="true"
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="lamp-footnote">
              글자 수 비율은 측정값이에요. 기여의 질을 뜻하지 않아요.
            </p>
          </section>
        </div>

        <aside className="lamp-dash-side">
          <section
            className="lamp-section-block"
            aria-labelledby="docs-members"
          >
            <header className="lamp-block-title">
              <h2 id="docs-members">팀원 구글 연결</h2>
            </header>
            <ul className="lamp-docs-members">
              {g.members.map((m, i) => (
                <li key={m.user_id}>
                  <Avatar name={m.name} tone={i % 4} size="sm" />
                  <span>{m.name}</span>
                  <StatusBadge tone={m.connected ? "success" : "warning"}>
                    {m.connected ? "연결됨" : "미연결"}
                  </StatusBadge>
                </li>
              ))}
            </ul>
            {unconnected.length > 0 && (
              <p className="lamp-footnote">
                미연결 팀원의 직접 수정은 보관만 돼요. 한양 구글 계정으로
                로그인하면 자동으로 연결되고 과거 수정도 소급 반영돼요.
              </p>
            )}
          </section>
          <HowItWorks />
        </aside>
      </div>
    </>
  );
}

function MockDocuments() {
  const { ws, connectDocument } = useStudent();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setPending(true);
    try {
      await connectDocument(url, name);
      setUrl("");
      setName("");
      setMessage(
        "문서 링크를 예시 목록에 추가했어요. Google 동기화는 하지 않아요.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "문서를 추가하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        title="문서"
        description="팀이 함께 쓰는 Google 문서 · 슬라이드 · 시트를 연결하면, 누가 무엇을 썼는지 자동으로 모여요."
        action={
          <a
            className="lamp-button"
            href={`/login?next=${encodeURIComponent("/lamp/documents")}`}
          >
            <LogIn size={14} /> 로그인하고 연결
          </a>
        }
      />
      <div className="lamp-docs-account">
        <span className="lamp-docs-account-dot" aria-hidden="true" />
        <p>
          <b>예시 화면이에요.</b> 한양 구글 계정으로 로그인하면 드라이브가 함께
          연결돼 실제 문서를 고를 수 있어요.
        </p>
      </div>
      <div className="lamp-dash-layout">
        <div className="lamp-dash-main">
          <section className="lamp-section-block" aria-labelledby="docs-list">
            <header className="lamp-block-title">
              <h2 id="docs-list">
                연결된 문서{" "}
                <span className="lamp-count">{ws.documents.length}</span>
              </h2>
            </header>
            <ul className="lamp-docs-list">
              {ws.documents.map((d) => (
                <li
                  key={d.id}
                  className="lamp-docs-row is-link"
                >
                  <DocumentIcon type={d.type} />
                  <div className="lamp-docs-main">
                    <div className="lamp-docs-title">
                      <h3>
                        <OpenLink id={d.id}>{d.name}</OpenLink>
                      </h3>
                      <SourceLink url={d.sourceUrl} compact />
                    </div>
                    <p className="lamp-docs-meta">
                      Google {DOC_TYPE_LABEL[d.type]} · 감지된 변경{" "}
                      {d.changeCount}건
                      {d.updatedAt
                        ? ` · 최근 수정 ${relativeTime(d.updatedAt)}`
                        : ""}
                    </p>
                  </div>
                  <ChevronRight
                    className="lamp-docs-chevron"
                    size={18}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ul>
          </section>
          <section className="lamp-section-block" aria-labelledby="docs-add">
            <header className="lamp-block-title">
              <h2 id="docs-add">링크로 추가 (예시)</h2>
            </header>
            <form className="lamp-docs-form" onSubmit={submit}>
              <label className="lamp-field-label" htmlFor="document-name">
                문서 이름 <span>(선택)</span>
              </label>
              <input
                className="lamp-input"
                id="document-name"
                placeholder="예: 데이터 분석 최종 보고서"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label className="lamp-field-label" htmlFor="document-url">
                Google Docs / Slides URL
              </label>
              <div className="lamp-input-row">
                <input
                  className="lamp-input"
                  id="document-url"
                  type="url"
                  required
                  placeholder="https://docs.google.com/document/d/…"
                  aria-invalid={!!error}
                  aria-describedby={error ? "document-error" : "document-hint"}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button className="lamp-button" disabled={pending}>
                  {pending ? "추가 중…" : "연결하기"}
                </button>
              </div>
              {error && (
                <p id="document-error" className="lamp-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="lamp-success" role="status">
                  <CheckCircle2 size={16} />
                  {message}
                </p>
              )}
              <p id="document-hint" className="lamp-help">
                예시 화면에서는 URL만 이 브라우저에 저장해요.
              </p>
            </form>
          </section>
        </div>
        <aside className="lamp-dash-side">
          <HowItWorks />
        </aside>
      </div>
    </>
  );
}

export function Documents() {
  const { ws } = useStudent();
  return ws.mode === "live" ? <LiveDocuments /> : <MockDocuments />;
}
