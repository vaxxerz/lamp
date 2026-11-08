"use client";
import { Suspense, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, CheckCircle2, Circle, GripVertical, LogIn, Pencil, Plus, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { createTask, deleteTask, moveTask, updateTask } from "@/lib/student/live";
import type { Task, TaskStatus } from "@/lib/student/types";
import { useStudent } from "./StudentProvider";
import { Dialog } from "./Dialog";
import { Avatar, EmptyState, PageHeading } from "./ui";

const COLUMNS = [
  { status: "todo", label: "할 일" },
  { status: "doing", label: "진행 중" },
  { status: "done", label: "완료" },
] as const;
const isStatus = (value: string): value is TaskStatus => COLUMNS.some((c) => c.status === value);
const DRAG_TYPE = "application/x-lamp-task";

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

function EditTask({ task, close, run }: { readonly task: Task; readonly close: () => void; readonly run: Run }) {
  const { ws, supabase } = useStudent();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError("");
    const saved = await run(() => updateTask(supabase, task.id, {
      title: title.trim(), description: description.trim() || null, due_date: dueDate || null,
    }), "할 일을 수정했어요.");
    setSaving(false);
    if (saved) close();
    else setError("수정 내용을 저장하지 못했어요. 다시 시도해 주세요.");
  }
  return <Dialog close={() => { if (!saving) close(); }} labelId="edit-task-title">
    <form className="lamp-task-editor" onSubmit={save}>
      <h2 id="edit-task-title">할 일 수정</h2>
      <label>제목<input autoFocus className="lamp-input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>설명<textarea className="lamp-input" rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>마감일<input type="date" className="lamp-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      <p className="lamp-help">{ws.team.name}의 할 일</p>
      {error && <p className="lamp-error" role="alert">{error}</p>}
      <div className="lamp-actions"><button type="button" className="lamp-button secondary" disabled={saving} onClick={close}>취소</button><button className="lamp-button" disabled={saving || !title.trim()}>{saving ? "저장 중…" : "저장"}</button></div>
    </form>
  </Dialog>;
}

function TaskCard({ task, run, busy, dragging, onDrag, onDrop, onMove, first, last, selected }: {
  readonly task: Task; readonly run: Run; readonly busy: boolean; readonly dragging: boolean;
  readonly onDrag: (id: string | null) => void; readonly onDrop: (e: DragEvent, before: string) => void;
  readonly onMove: (direction: "up" | "down") => void; readonly first: boolean; readonly last: boolean; readonly selected: boolean;
}) {
  const { ws, supabase } = useStudent();
  const [editing, setEditing] = useState(false);
  const name = (id: string | null) => ws.users.find((u) => u.id === id)?.name;
  const canVerify = task.status === "done" && !task.verifiedBy && task.completedBy !== ws.me.id;
  return <>
    <article id={`task-${task.id}`} tabIndex={-1} aria-current={selected ? "true" : undefined} className={`lamp-card lamp-task${dragging ? " is-dragging" : ""}`} onDrop={(e) => onDrop(e, task.id)}>
      <div className="lamp-task-top">
        <button className="lamp-icon-button lamp-task-grip" draggable={!busy} disabled={busy} aria-label={`${task.title} 드래그하여 이동`} data-tooltip="드래그하여 이동"
          onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, task.id); e.dataTransfer.effectAllowed = "move"; onDrag(task.id); }}
          onDragEnd={() => onDrag(null)}><GripVertical size={15} /></button>
        <strong>{task.title}</strong>
        <button className="lamp-icon-button" disabled={busy} aria-label={`${task.title} 수정`} data-tooltip="수정" onClick={() => setEditing(true)}><Pencil size={15} /></button>
        <button className="lamp-icon-button" disabled={busy} aria-label={`${task.title} 삭제`} data-tooltip="삭제" onClick={() => void run(() => deleteTask(supabase, task.id), "할 일을 삭제했어요.")}><Trash2 size={15} /></button>
      </div>
      <div className="lamp-task-reorder">
        <button className="lamp-text-button" disabled={busy || first} aria-label={`${task.title} 위로 이동`} onClick={() => onMove("up")}><ArrowUp size={14} /> 위로</button>
        <button className="lamp-text-button" disabled={busy || last} aria-label={`${task.title} 아래로 이동`} onClick={() => onMove("down")}><ArrowDown size={14} /> 아래로</button>
      </div>
      {task.description && <p className="lamp-task-description">{task.description}</p>}
      {task.dueDate && <p className="lamp-help">마감 {task.dueDate}</p>}
      <div className="lamp-task-fields">
        <label><span className="lamp-sr-only">{task.title} 상태</span><select disabled={busy} value={task.status} onChange={(e) => { const status = e.target.value; if (isStatus(status)) void run(() => updateTask(supabase, task.id, { status }), "상태를 변경했어요."); }}>{COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}</select></label>
        <label><span className="lamp-sr-only">{task.title} 담당자</span><select disabled={busy} value={task.assigneeId ?? ""} onChange={(e) => void run(() => updateTask(supabase, task.id, { assignee_id: e.target.value || null }), "담당자를 변경했어요.")}><option value="">담당자 없음</option>{ws.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      </div>
      {task.status === "done" && <div className="lamp-task-verification">
        {task.completedBy && <p className="lamp-help"><Avatar name={name(task.completedBy) ?? "?"} /> {name(task.completedBy)} 완료</p>}
        {task.verifiedBy ? <>
          <span className="lamp-positive"><ShieldCheck size={14} /> {name(task.verifiedBy)} 확인</span>
          {task.verifiedBy === ws.me.id && <button className="lamp-button secondary lamp-verify-button" disabled={busy} onClick={() => void run(() => updateTask(supabase, task.id, { verified_by: null }), "확인을 취소했어요.")}><Undo2 size={14} /> 확인 취소</button>}
        </> : canVerify ? <button className="lamp-button secondary lamp-verify-button" disabled={busy} onClick={() => void run(() => updateTask(supabase, task.id, { verified_by: ws.me.id }), "완료를 확인했어요.")}><CheckCircle2 size={14} /> 완료 확인</button> : <span className="lamp-help"><Circle size={12} /> 다른 팀원의 확인을 기다려요</span>}
      </div>}
    </article>
    {editing && <EditTask task={task} close={() => setEditing(false)} run={run} />}
  </>;
}

export function Board() {
  return <Suspense fallback={<p role="status">작업 보드를 불러오는 중…</p>}><BoardContent /></Suspense>;
}
function BoardContent() {
  const { ws, supabase, act } = useStudent();
  const requestedTask = useSearchParams().get("task");
  const requestedTaskExists = ws.tasks.some((task) => task.id === requestedTask);
  useEffect(() => {
    if (!requestedTask || !requestedTaskExists) return;
    const card = document.getElementById(`task-${requestedTask}`);
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
  }, [requestedTask, requestedTaskExists, ws.team.id]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const run: Run = async (fn, ok = "") => {
    setError(""); setMessage(""); setBusy(true);
    try { await act(fn); setMessage(ok); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); return false; }
    finally { setBusy(false); }
  };
  if (ws.mode !== "live") return <><PageHeading title="작업 보드" description="팀 할 일을 나누고, 완료하면 다른 팀원이 확인해요." /><EmptyState><a className="lamp-button" href="/login?next=%2Flamp%2Fboard"><LogIn size={16} /> 로그인하면 팀 보드를 쓸 수 있어요</a></EmptyState></>;
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    const last = Math.max(0, ...ws.tasks.filter((x) => x.status === "todo").map((x) => x.position));
    if (await run(() => createTask(supabase, ws.team.id, title.trim(), last + 1), "할 일을 추가했어요.")) setTitle("");
  }
  function drop(e: DragEvent, status: TaskStatus, before?: string) {
    e.preventDefault(); e.stopPropagation(); setDragging(null); setOver(null);
    const task = ws.tasks.find((t) => t.id === e.dataTransfer.getData(DRAG_TYPE));
    if (!task || busy || task.id === before) return;
    void run(() => moveTask(supabase, task.id, status, before ?? null), `${status === task.status ? "순서를 변경" : `${COLUMNS.find((c) => c.status === status)?.label}(으)로 이동`}했어요.`);
  }
  return <>
    <PageHeading title="작업 보드" description="손잡이를 드래그해 할 일을 옮기세요. 상태 메뉴로도 이동할 수 있어요." />
    <form className="lamp-card lamp-input-row lamp-task-form" onSubmit={add}><input className="lamp-input" aria-label="새 할 일" required value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="새 할 일 (예: 발표 자료 3장 정리)" /><button className="lamp-button" disabled={busy || !title.trim()}><Plus size={16} />추가</button></form>
    {error && <p className="lamp-error" role="alert">{error}</p>}
    <p className="lamp-board-feedback" role="status">{busy ? "저장 중…" : message}</p>
    <div className="lamp-board" aria-busy={busy}>{COLUMNS.map((col) => {
      const tasks = ws.tasks.filter((t) => t.status === col.status).sort((a, b) => a.position - b.position);
      return <section key={col.status} className={`lamp-board-column${over === col.status ? " is-drop-target" : ""}`} aria-label={col.label}
        onDragOver={(e) => { if (!busy && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(col.status); } }}
        onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
        onDrop={(e) => drop(e, col.status)}>
        <h2>{col.label} <span>{tasks.length}</span></h2>
        {tasks.map((t, index) => <TaskCard key={t.id} task={t} run={run} busy={busy} selected={t.id === requestedTask} first={index === 0} last={index === tasks.length - 1} onMove={(direction) => {
          const before = direction === "up" ? tasks[index - 1]?.id : tasks[index + 2]?.id;
          void run(() => moveTask(supabase, t.id, col.status, before ?? null), "순서를 변경했어요.");
        }} dragging={dragging === t.id} onDrag={(id) => { setDragging(id); if (!id) setOver(null); }} onDrop={(e, before) => drop(e, col.status, before)} />)}
        {tasks.length === 0 && <p className="lamp-board-empty">{dragging ? "여기에 놓으세요" : "할 일이 없어요"}</p>}
      </section>;
    })}</div>
  </>;
}
