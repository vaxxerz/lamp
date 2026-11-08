"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { relativeTime } from "./ui";

const notificationSchema = z.object({
  id: z.string(), team_id: z.string(), title: z.string(), body: z.string(),
  href: z.string().regex(/^\/(lamp|professor)\//), available_at: z.string(), read_at: z.string().nullable(),
});
type Notification = z.infer<typeof notificationSchema>;

export function useNotifications({ userId, live, supabase }: {
  readonly userId: string; readonly live: boolean; readonly supabase: SupabaseClient;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const reload = useCallback(async () => {
    if (!live) return;
    const version = ++request.current;
    try {
      const [rows, count] = await Promise.all([
        supabase.from("notifications").select("id, team_id, title, body, href, available_at, read_at")
          .eq("recipient_id", userId).lte("available_at", new Date().toISOString()).order("available_at", { ascending: false }).limit(100),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", userId).is("read_at", null),
      ]);
      if (rows.error || count.error) throw new Error("알림을 불러오지 못했어요. 다시 시도해 주세요.");
      const parsed = z.array(notificationSchema).parse(rows.data);
      if (request.current !== version) return;
      setItems(parsed); setUnread(count.count ?? 0); setError("");
    } catch (e) {
      if (request.current === version) setError(e instanceof Error ? e.message : "알림을 불러오지 못했어요.");
    } finally { if (request.current === version) setLoading(false); }
  }, [live, supabase, userId]);
  useEffect(() => {
    if (!live) return;
    void (async () => { await reload(); })();
    const sequence = request;
    const channel = supabase.channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, () => void reload())
      .subscribe();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    // Queued meeting reminders become visible as their scheduled time passes.
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); void supabase.removeChannel(channel); };
  }, [live, reload, supabase, userId]);
  async function markRead(id?: string) {
    const now = new Date().toISOString();
    let query = supabase.from("notifications").update({ read_at: now }).eq("recipient_id", userId).is("read_at", null).lte("available_at", now);
    if (id) query = query.eq("id", id);
    const { error } = await query;
    if (error) { setError("읽음 상태를 저장하지 못했어요."); return false; }
    await reload();
    return true;
  }
  return { items: live ? items : [], unread: live ? unread : 0, loading: live && loading, error: live ? error : "", reload, markRead };
}

export function NotificationPanel({ notifications, close, teamName, beforeOpen }: {
  readonly notifications: ReturnType<typeof useNotifications>; readonly close: () => void;
  readonly teamName: (teamId: string) => string; readonly beforeOpen?: (teamId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open(item: Notification) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await beforeOpen?.(item.team_id);
      if (!await notifications.markRead(item.id)) return;
      router.push(item.href); close();
    } catch (e) { setError(e instanceof Error ? e.message : "알림을 열지 못했어요."); }
    finally { setBusy(false); }
  }
  return <section className="lamp-notifications" aria-label="알림 목록">
    <div className="lamp-notifications-heading"><h3>알림 {notifications.unread > 0 && <span>{notifications.unread}</span>}</h3>
      <button className="lamp-text-button" disabled={busy || notifications.unread === 0} onClick={async () => { setBusy(true); await notifications.markRead(); setBusy(false); }}><CheckCheck size={14} /> 모두 읽음</button>
    </div>
    {(notifications.error || error) && <p className="lamp-error" role="alert">{error || notifications.error} <button className="lamp-text-button" onClick={() => void notifications.reload()}>다시 시도</button></p>}
    {notifications.loading ? <p role="status">알림을 불러오는 중…</p> : notifications.items.length === 0 ? <div className="lamp-notifications-empty"><Bell size={24} /><p>새로운 알림이 없어요</p><small>할 일 변경과 회의 일정 등을 여기서 알려드려요.</small></div> : <ul>
      {notifications.items.map((item) => <li key={item.id} data-unread={!item.read_at}>
        <button disabled={busy} onClick={() => void open(item)}>
          <strong>{item.title}</strong><span>{item.body}</span>
          <small>{teamName(item.team_id)} · {relativeTime(item.available_at)}</small>
        </button>
      </li>)}
    </ul>}
    <p className="lamp-notifications-footnote">회의 하루 전·한 시간 전 / 할 일 마감 알림 · 최근 100개</p>
  </section>;
}
