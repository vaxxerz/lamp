"use client";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  MapPin,
  NotebookPen,
  Plus,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { addMeetingComment, setAttendanceComment } from "@/lib/student/live";
import type { AttendanceStatus, Meeting } from "@/lib/student/types";
import { useStudent } from "./StudentProvider";
import { Avatar, EmptyState, PageHeading, formatTime } from "./ui";
const statuses: Record<AttendanceStatus, string> = {
  unchecked: "미체크",
  present: "출석",
  late: "지각",
  absent: "결석",
  excused: "사유 불참",
};
function MeetingEditor({ meeting }: { meeting: Meeting }) {
  const { ws, setAttendance, saveNotes, supabase, act } = useStudent();
  const [comment, setComment] = useState("");
  const { users, me } = ws;
  const live = ws.mode === "live";
  const [notes, setNotes] = useState(meeting.notes);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(operation: () => Promise<void>, success: string) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="lamp-meeting-detail">
      <div className="lamp-meeting-title">
        <span className="lamp-eyebrow">TEAM MEETING</span>
        <h2>{meeting.title}</h2>
        <div>
          <span>
            <CalendarDays size={15} />
            {formatTime(meeting.heldAt)}
          </span>
          <span>
            <MapPin size={15} />
            {meeting.location || "장소 미정"}
          </span>
        </div>
      </div>
      <section className="lamp-card lamp-attendance">
        <div className="lamp-section-title">
          <h3>팀원 출석 확인</h3>
          <span className="lamp-badge purple">
            {
              Object.values(meeting.attendance).filter(
                (s) => s === "present" || s === "late",
              ).length
            }{" "}
            / {users.length}명 참석
          </span>
        </div>
        <p className="lamp-help">
          직접 만난 팀원의 출석을 확인해 주세요. 본인 출석은 다른 팀원만 체크할
          수 있어요.
        </p>
        <div className="lamp-attendance-list">
          {users.map((u, i) => (
            <div className="lamp-attendance-row" key={u.id}>
              <Avatar name={u.name} tone={i} />
              <div>
                <strong>
                  {u.name}
                  {u.id === me.id && " (나)"}
                </strong>
                <small>
                  {u.id === me.id
                    ? "다른 팀원의 확인이 필요해요"
                    : "출석 상태를 선택해 주세요"}
                </small>
              </div>
              <label>
                <span className="lamp-sr-only">{u.name} 출석 상태</span>
                <select
                  disabled={u.id === me.id || pending}
                  value={meeting.attendance[u.id] || "unchecked"}
                  onChange={(e) => {
                    const status = e.target.value as AttendanceStatus;
                    void run(
                      () => setAttendance(meeting.id, u.id, status),
                      `${u.name}님의 출석 상태를 저장했어요.`,
                    );
                  }}
                >
                  {Object.entries(statuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {live && (
                <input
                  className="lamp-input lamp-attendance-comment"
                  aria-label={`${u.name} 출결 코멘트`}
                  placeholder={u.id === me.id ? "사유 등 한 줄 (본인도 작성 가능)" : "한 줄 코멘트"}
                  maxLength={300}
                  defaultValue={meeting.attendanceComments?.[u.id] ?? ""}
                  disabled={pending}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v === (meeting.attendanceComments?.[u.id] ?? "")) return;
                    void run(() => act(() => setAttendanceComment(supabase, meeting.id, u.id, v)), "코멘트를 저장했어요.");
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="lamp-attendance-hint">
          <ShieldCheck size={16} />
          {live
            ? "본인 출석 변경은 화면과 데이터베이스 양쪽에서 막혀 있어요."
            : "본인 출석 변경은 UI와 Mock API 양쪽에서 제한합니다."}
        </div>
      </section>
      <section className="lamp-card lamp-notes">
        <div className="lamp-section-title">
          <h3>
            <NotebookPen size={18} />
            회의록
          </h3>
          <button
            className="lamp-button"
            disabled={pending || notes === meeting.notes}
            onClick={() =>
              void run(
                () => saveNotes(meeting.id, notes),
                live ? "회의록을 저장했어요. 기여 기록에도 반영돼요." : "회의록을 브라우저에 저장했어요.",
              )
            }
          >
            <Save size={15} />
            {pending ? "저장 중…" : "회의록 저장"}
          </button>
        </div>
        <label className="lamp-sr-only" htmlFor="meeting-notes">
          회의록 내용
        </label>
        <textarea
          id="meeting-notes"
          className="lamp-notes-input"
          placeholder="안건, 논의 내용, 결정 사항과 다음 할 일을 기록해 보세요."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={20000}
        />
        <p className="lamp-help">
          {notes !== meeting.notes
            ? "저장하지 않은 변경 사항이 있어요."
            : "저장된 회의록입니다."}{" "}
          · {notes.length.toLocaleString()} / 20,000자
        </p>
      </section>
      {live && (
        <section className="lamp-card lamp-notes">
          <div className="lamp-section-title">
            <h3>코멘트 {meeting.comments?.length ? <span>{meeting.comments.length}</span> : null}</h3>
          </div>
          <ul className="lamp-revisions">
            {(meeting.comments ?? []).map((c) => (
              <li key={c.id}>
                <b>{users.find((u) => u.id === c.authorId)?.name ?? "팀원"}</b> {c.body}{" "}
                <span className="lamp-muted">{formatTime(c.createdAt)}</span>
              </li>
            ))}
          </ul>
          <form
            className="lamp-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              const body = comment.trim();
              if (!body) return;
              void run(() => act(() => addMeetingComment(supabase, ws.team.id, meeting.id, body)), "코멘트를 남겼어요.");
              setComment("");
            }}
          >
            <input
              className="lamp-input"
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
              placeholder="회의에 대한 코멘트 남기기"
            />
            <button className="lamp-button" disabled={pending}>
              남기기
            </button>
          </form>
        </section>
      )}
      {error && (
        <p className="lamp-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="lamp-success" role="status">
          <CheckCircle2 size={16} />
          {message}
        </p>
      )}
    </section>
  );
}
export function Meetings() {
  return <Suspense fallback={<p role="status">회의를 불러오는 중…</p>}><MeetingsContent /></Suspense>;
}
function MeetingsContent() {
  const { ws, createMeeting } = useStudent();
  const data = ws;
  const params = useSearchParams();
  const requested = params.get("meeting");
  const [selection, setSelection] = useState<{ requested: string | null; id: string } | null>(null);
  const selected = selection?.requested === requested ? selection.id : data.meetings.find((m) => m.id === requested)?.id ?? data.meetings[0]?.id ?? "";
  const setSelected = (id: string) => setSelection({ requested, id });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const meeting = data.meetings.find((m) => m.id === selected);
  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim() || !date) {
      setError("회의 제목과 일시를 입력해 주세요.");
      return;
    }
    setPending(true);
    try {
      const id = await createMeeting({
        title: title.trim(),
        heldAt: new Date(`${date}+09:00`).toISOString(),
        location: location.trim(),
      });
      setSelected(id);
      setCreating(false);
      setTitle("");
      setDate("");
      setLocation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "회의를 추가하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        title="회의록 · 출석"
        description="함께 나눈 이야기와 직접 만난 팀원의 출석을 기록해요."
        action={
          <button
            className="lamp-button"
            onClick={() => {
              setCreating(!creating);
              setError("");
            }}
          >
            {creating ? <X size={17} /> : <Plus size={17} />}
            {creating ? "닫기" : "새 회의 만들기"}
          </button>
        }
      />
      {creating && (
        <form className="lamp-card lamp-meeting-form" onSubmit={create}>
          <h2>새 회의</h2>
          <label className="lamp-field-label" htmlFor="meeting-title">
            회의 제목
          </label>
          <input
            id="meeting-title"
            className="lamp-input"
            autoFocus
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 최종 발표 리허설"
          />
          <div className="lamp-form-grid">
            <label className="lamp-field-label">
              회의 일시 (한국 시간)
              <input
                className="lamp-input"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="lamp-field-label">
              장소
              <input
                className="lamp-input"
                value={location}
                maxLength={150}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="예: 중앙도서관 스터디룸"
              />
            </label>
          </div>
          {error && (
            <p className="lamp-error" role="alert">
              {error}
            </p>
          )}
          <button className="lamp-button" disabled={pending}>
            {pending ? "추가 중…" : "회의 만들기"}
          </button>
        </form>
      )}
      <div className="lamp-meetings-layout">
        <aside className="lamp-meeting-list">
          <h2>
            우리 팀 회의 <span>{data.meetings.length}</span>
          </h2>
          {[...data.meetings]
            .sort((a, b) => Date.parse(b.heldAt) - Date.parse(a.heldAt))
            .map((m) => (
              <button
                key={m.id}
                className={selected === m.id ? "active" : ""}
                aria-pressed={selected === m.id}
                onClick={() => setSelected(m.id)}
              >
                <CalendarDays size={18} />
                <span>
                  <strong>{m.title}</strong>
                  <small>{formatTime(m.heldAt)}</small>
                </span>
              </button>
            ))}
        </aside>
        {meeting ? (
          <MeetingEditor key={meeting.id} meeting={meeting} />
        ) : (
          <EmptyState>새 회의를 만들어 회의록을 남겨 보세요.</EmptyState>
        )}
      </div>
      <div className="lamp-info-note">
        <ShieldCheck size={18} />
        <p>
          {ws.mode === "live"
            ? "회의록과 출석은 팀원 모두에게 공유되고, 출석 · 회의록 작성도 기여로 기록돼요."
            : "회의록과 출석은 이 브라우저에만 저장되는 데모입니다. 로그인하면 팀과 공유되는 실데이터로 바뀌어요."}
        </p>
      </div>
    </>
  );
}
