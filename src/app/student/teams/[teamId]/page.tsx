import { Suspense } from "react";
import { Loading, Todo } from "@/components/Todo";
import { createClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/types";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "할 일" },
  { status: "doing", label: "진행 중" },
  { status: "done", label: "완료" },
];

async function Board({ params }: { params: PageProps<"/student/teams/[teamId]">["params"] }) {
  const { teamId } = await params;
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, assignee:profiles!tasks_assignee_id_fkey(name), verified_by")
    .eq("team_id", teamId)
    .order("position");

  return (
    <div className="flex flex-col gap-4">
      <Todo owner="B">
        칸반 보드 — 태스크 생성 · 드래그로 상태 변경 · 담당자 지정 · 완료 후 <b>다른 팀원의 &quot;확인&quot;</b> 버튼
        (tasks.verified_by = 내 id). Realtime으로 tasks 구독.
      </Todo>
      <div className="grid gap-4 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <section key={col.status} className="card flex flex-col gap-2">
            <h2 className="font-semibold">{col.label}</h2>
            {(tasks ?? [])
              .filter((t) => t.status === col.status)
              .map((t) => (
                <div key={t.id} className="rounded-lg bg-zinc-100 p-2 text-sm dark:bg-zinc-900">
                  {t.title}
                  <span className="ml-1 text-xs text-zinc-500">
                    {(t.assignee as unknown as { name: string } | null)?.name ?? "담당자 없음"}
                    {t.verified_by && " · ✅확인됨"}
                  </span>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function Page(props: PageProps<"/student/teams/[teamId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Board params={props.params} />
    </Suspense>
  );
}
