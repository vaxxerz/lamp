import {
  FileText,
  Presentation,
  Sheet,
  ExternalLink,
  FolderKanban,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AttributionStatus, ConnectedDocument } from "@/lib/student/types";
export function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
/** 워드마크 — "Lamp." 마침표만 강조색 */
export function LampLogo() {
  return (
    <span className="lamp-logo" aria-label="Lamp">
      Lamp<span aria-hidden="true">.</span>
    </span>
  );
}
export function Avatar({ name, tone = 0, size }: { name: string; tone?: number; size?: "sm" }) {
  return (
    <span className={`lamp-avatar tone-${tone}${size ? ` ${size}` : ""}`} title={name}>
      {name.slice(0, 1)}
    </span>
  );
}
/** 겹친 팀원 아바타 (+N) */
export function AvatarGroup({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="lamp-avatar-group" aria-label={`팀원 ${names.length}명: ${names.join(", ")}`} role="img">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} tone={i % 4} size="sm" />
      ))}
      {names.length > max && <span className="lamp-avatar sm tone-3">+{names.length - max}</span>}
    </span>
  );
}
export type StatusTone = "neutral" | "progress" | "success" | "warning" | "danger";
/** 점 + 글자 상태 표시 (색만으로 구분하지 않도록 항상 글자와 함께) */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`lamp-status ${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
/** 작업 상태 아이콘: 빈 원(할 일) · 반 원(진행 중) · 체크(완료) */
export function TaskStatusIcon({ status }: { status: "todo" | "doing" | "done" }) {
  const label = status === "todo" ? "할 일" : status === "doing" ? "진행 중" : "완료";
  return (
    <svg className={`lamp-task-status ${status}`} width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={label}>
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={status === "todo" ? "2.2 1.6" : undefined} />
      {status === "doing" && <path d="M7 3a4 4 0 0 1 0 8Z" fill="currentColor" />}
      {status === "done" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.3 7.2 6.1 9l3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
/** "3분 전 · 2시간 전 · 어제 · 11. 2." */
export function relativeTime(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "어제";
  if (day < 7) return `${day}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(iso));
}
export const DOC_TYPE_LABEL = { docs: "Docs", slides: "Slides", sheets: "Sheets" } as const;
export function DocumentIcon({ type }: { type: ConnectedDocument["type"] }) {
  const Icon = type === "docs" ? FileText : type === "sheets" ? Sheet : Presentation;
  return (
    <span className={`lamp-doc-icon ${type}`}>
      <Icon size={25} strokeWidth={1.7} />
    </span>
  );
}
export function AttributionBadge({ status }: { status: AttributionStatus }) {
  return (
    <span className={`lamp-badge ${status}`}>
      {status === "verified"
        ? "작성자 확인됨"
        : status === "inferred"
          ? "작성자 추정"
          : "작성자 미확인"}
    </span>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="lamp-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="lamp-empty">
      <FolderKanban size={22} strokeWidth={1.8} aria-hidden="true" />
      <h3>아직 표시할 내용이 없어요</h3>
      <p>{children}</p>
    </div>
  );
}
export function SourceLink({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const sample = !url || url.includes("/lamp-demo-");
  return sample ? (
    <span
      className="lamp-source-sample"
      title="시연용 예시 문서라 실제 Google 원본이 없습니다."
    >
      {compact ? "예시 문서" : "예시 문서 · 원본 없음"}
    </span>
  ) : (
    <a
      className="lamp-source-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Google 원본 문서 열기"
    >
      {!compact && "원본 열기"}
      <ExternalLink size={17} />
    </a>
  );
}
export function DocumentCard({
  document,
  href,
}: {
  document: ConnectedDocument;
  /** 있으면 카드 전체가 문서 분석 화면으로 가는 링크 */
  href?: string;
}) {
  return (
    <article className={`lamp-document lamp-card${href ? " is-link" : ""}`}>
      <DocumentIcon type={document.type} />
      <div className="lamp-document-name">
        <h3>
          {href ? (
            <Link className="lamp-docs-open" href={href}>
              {document.name}
            </Link>
          ) : (
            document.name
          )}
        </h3>
        <p>
          Google {DOC_TYPE_LABEL[document.type]} <span>·</span>{" "}
          감지된 변경 {document.changeCount}건
        </p>
      </div>
      <span className="lamp-document-time">
        {document.updatedAt
          ? `최근 수정: ${formatTime(document.updatedAt)}`
          : "수정 시각 미수집"}
      </span>
      <SourceLink url={document.sourceUrl} compact />
    </article>
  );
}
export function StatCard({
  label,
  value,
  icon,
  children,
  feature = false,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  children?: ReactNode;
  /** 벤토의 큰 칸 (대시보드 핵심 지표) */
  feature?: boolean;
}) {
  return (
    <article className={`lamp-stat lamp-card${feature ? " lamp-stat-feature" : ""}`}>
      <span className="lamp-stat-icon">{icon}</span>
      <div>
        <h3>{label}</h3>
        <strong>{value}</strong>
        {children}
      </div>
    </article>
  );
}
export function SmallArrow() {
  return <ArrowUpRight size={16} />;
}
