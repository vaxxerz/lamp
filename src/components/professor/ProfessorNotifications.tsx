"use client";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { NotificationPanel, useNotifications } from "@/components/student/Notifications";

export function ProfessorNotifications({ userId, live, teams }: {
  readonly userId: string; readonly live: boolean; readonly teams: readonly { readonly id: string; readonly name: string }[];
}) {
  const [supabase] = useState(createClient);
  const notifications = useNotifications({ userId, live, supabase });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => { if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="prof-notification-anchor" ref={ref}>
    <button className="lamp-icon-button" aria-label={`알림${notifications.unread ? `, 읽지 않은 알림 ${notifications.unread}개` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={16} />{notifications.unread > 0 && <span className="lamp-notification-dot" />}</button>
    {open && <div className="lamp-popover"><NotificationPanel notifications={notifications} close={() => setOpen(false)} teamName={(id) => teams.find((team) => team.id === id)?.name ?? "수업 팀"} /></div>}
  </div>;
}
