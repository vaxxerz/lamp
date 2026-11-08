"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useStudentOptional } from "./StudentProvider";
import type { ConnectedDocument, ContributionActivity, User } from "@/lib/student/types";
import {
  AttributionBadge,
  Avatar,
  DocumentIcon,
  EmptyState,
  SourceLink,
  formatTime,
} from "./ui";
export function ActivityCard({
  activity,
  compact = false,
  users: usersProp,
  documents: documentsProp,
}: {
  activity: ContributionActivity;
  compact?: boolean;
  users?: User[];
  documents?: ConnectedDocument[];
}) {
  const [expanded, setExpanded] = useState(false);
  // 교수 화면은 StudentProvider 밖이라 팀 사용자 · 문서를 직접 넘긴다
  const ctx = useStudentOptional();
  const users = usersProp ?? ctx?.ws.users ?? [];
  const documents = documentsProp ?? ctx?.ws.documents ?? [];
  const user =
    activity.attributionStatus === "unknown"
      ? undefined
      : users.find((u) => u.id === activity.userId);
  const document = documents.find((d) => d.id === activity.documentId);
  if (!document) return null;
  // 팀원과 매칭 안 된 구글 작성자는 이름만 보여주고 기여로는 세지 않음
  // 편집 시간대 (구글 Activity / 제안 시각)
  const clock = (iso: string) =>
    new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Seoul" }).format(
      new Date(iso),
    );
  const editWindow =
    activity.editedFrom && activity.editedTo && activity.editedFrom !== activity.editedTo
      ? ` · 편집 ${clock(activity.editedFrom)}~${clock(activity.editedTo)}`
      : "";
  const authorLabel = user?.name ?? (activity.authorName ? `${activity.authorName} (미연결)` : "작성자 미확인");
  const typeLabel = { docs: "Docs", slides: "Slides", sheets: "Sheets" }[document.type];
  const content = activity.contentAfter || activity.contentBefore || "";
  const long = content.length > 100;
  if (compact)
    return (
      <article className="lamp-recent-row">
        <DocumentIcon type={document.type} />
        <div className="lamp-recent-info">
          <h3>{activity.title}</h3>
          <p>
            {authorLabel} · Google {typeLabel} ·{" "}
            {formatTime(activity.timestamp)}
          </p>
        </div>
        <AttributionBadge status={activity.attributionStatus} />
      </article>
    );
  return (
    <article id={activity.id} className="lamp-activity">
      <div className="lamp-timeline-dot" />
      <Avatar name={user?.name || "?"} tone={user ? users.indexOf(user) : 3} />
      <div className="lamp-activity-body">
        <div className="lamp-activity-top">
          <div>
            <h3>{activity.title}</h3>
            <p>
              {authorLabel} · {document.name} · Google {typeLabel} ·{" "}
              {formatTime(activity.timestamp)}
              {editWindow}
            </p>
          </div>
          <span className={`lamp-badge action-${activity.actionType}`}>
            {{ add: "추가", edit: "수정", delete: "삭제" }[activity.actionType]}
          </span>
        </div>
        <div className="lamp-change">
          <span className="lamp-change-label">
            {activity.actionType === "delete" ? "삭제된 내용" : "변경 후 내용"}
          </span>
          <p className={!expanded && long ? "lamp-clamp" : ""}>{content}</p>
          {expanded &&
            activity.contentBefore &&
            activity.actionType === "edit" && (
              <div className="lamp-before">
                <span className="lamp-change-label">변경 전 내용</span>
                <p>{activity.contentBefore}</p>
              </div>
            )}
        </div>
        <div className="lamp-activity-bottom">
          <AttributionBadge status={activity.attributionStatus} />
          <SourceLink url={activity.sourceUrl} compact />
          <button
            className="lamp-text-button"
            aria-expanded={expanded}
            aria-controls={`${activity.id}-detail`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "접기" : "상세 보기"}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        <div
          id={`${activity.id}-detail`}
          hidden={!expanded}
          className="lamp-activity-detail"
        >
          {activity.shares && (
            <p>
              공동 편집 구간: {activity.shares.map((s) => `${s.name} ${Math.round(s.share * 100)}%`).join(" · ")} (편집 시간 비율
              추정)
            </p>
          )}
          {!!activity.fragments?.length && (
            <ul className="lamp-fragments">
              {activity.fragments.map((f, i) => (
                <li key={i}>
                  <span className="lamp-muted">{f.line}번째 줄 · </span>
                  {f.before && <span className="lamp-muted">…{f.before}</span>}
                  {f.removed && <del>{f.removed}</del>}
                  {f.added && <ins>{f.added}</ins>}
                  {f.after && <span className="lamp-muted">{f.after}…</span>}
                </li>
              ))}
            </ul>
          )}
          {activity.attributionStatus === "verified"
            ? ctx?.ws.mode === "live"
              ? "구글 문서 제안 모드로 작성자가 확정된 기록입니다."
              : "작성자가 확인된 예시 기록입니다."
            : activity.attributionStatus === "inferred"
              ? ctx?.ws.mode === "live"
                ? "직접 수정이라 마지막 수정자 · 편집 시간 비율로 추정한 기록이며, 확인된 활동 수에 포함하지 않습니다."
                : "작성자가 추정된 기록이며, 확인된 활동 수에 포함하지 않습니다."
              : "작성자가 확인되지 않아 특정 학생에게 귀속하지 않습니다."}
        </div>
      </div>
    </article>
  );
}
export function ActivityTimeline({
  activities,
}: {
  activities: ContributionActivity[];
}) {
  return activities.length ? (
    <div className="lamp-timeline">
      {activities.map((a) => (
        <ActivityCard key={a.id} activity={a} />
      ))}
    </div>
  ) : (
    <EmptyState>다른 필터를 선택해 보세요.</EmptyState>
  );
}
