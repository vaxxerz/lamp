import type { SupabaseClient } from "@supabase/supabase-js";

const TABLES = [
  "profiles", "courses", "course_members", "teams", "team_members",
  "tasks", "documents", "document_revisions", "files", "file_versions",
  "activity_events", "meetings", "meeting_attendance", "meeting_comments",
  "kudos", "external_docs", "external_doc_revisions", "external_doc_credits",
  "external_doc_suggestions",
] as const;

/** Payloads are ignored; every reload still goes through the user's RLS policies. */
export function watchWorkspaceChanges(
  client: SupabaseClient,
  refresh: () => Promise<void>,
) {
  let active = true;
  let pending = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    timer = undefined;
    if (!active || running || document.visibilityState !== "visible" || !navigator.onLine) return;
    pending = false;
    running = true;
    try {
      await refresh();
    } finally {
      running = false;
      if (active && pending) schedule();
    }
  };
  const schedule = () => {
    if (!active) return;
    pending = true;
    if (!timer && !running) timer = setTimeout(() => void flush(), 350);
  };

  // Unfiltered subscriptions also receive deletes, whose payload may only contain a primary key.
  const channel = client.channel(`workspace-${crypto.randomUUID()}`);
  for (const table of TABLES) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
  }
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") schedule();
  });
  const fallback = setInterval(schedule, 60_000);
  window.addEventListener("focus", schedule);
  window.addEventListener("online", schedule);
  document.addEventListener("visibilitychange", schedule);

  return () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    clearInterval(fallback);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("online", schedule);
    document.removeEventListener("visibilitychange", schedule);
    void client.removeChannel(channel);
  };
}
