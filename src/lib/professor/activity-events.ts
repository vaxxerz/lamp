import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const eventSchema = z.object({
  id: z.string(), team_id: z.string(), user_id: z.string(),
  category: z.enum(["document", "task", "meeting", "file"]), created_at: z.string(),
});
export async function loadProfessorEvents(supabase: SupabaseClient, teamIds: readonly string[]) {
  // Supabase caps each response at 1,000 rows; keep every team's history in the ratio.
  const events = new Map<string, z.infer<typeof eventSchema>>();
  const cutoff = new Date().toISOString();
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("activity_events")
      .select("id, team_id, user_id, category, created_at").in("team_id", teamIds)
      .lte("created_at", cutoff).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 999);
    if (result.error) throw new Error(result.error.message);
    const rows = z.array(eventSchema).parse(result.data);
    for (const event of rows) events.set(event.id, event);
    if (rows.length < 1000) return { data: [...events.values()], error: null };
  }
}

