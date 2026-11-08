import Link from "next/link";
import { Suspense } from "react";
import { GoogleDocsPanel } from "@/components/google/GoogleDocsPanel";
import { Loading, Todo } from "@/components/Todo";
import { createClient } from "@/lib/supabase/server";

async function DocList({ params }: { params: PageProps<"/student/teams/[teamId]/docs">["params"] }) {
  const { teamId } = await params;
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, kind, updated_at")
    .eq("team_id", teamId)
    .eq("kind", "doc")
    .order("updated_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <GoogleDocsPanel teamId={teamId} />
      <h2 className="font-semibold">Lamp 문서</h2>
      <Todo owner="B">새 문서 만들기 버튼 — supabase.from(&quot;documents&quot;).insert({"{ team_id, title }"})</Todo>
      <ul className="flex flex-col gap-2">
        {(docs ?? []).map((d) => (
          <li key={d.id}>
            <Link href={`/student/teams/${teamId}/docs/${d.id}`} className="card block">
              {d.title}
              <span className="ml-2 text-xs text-zinc-500">{new Date(d.updated_at).toLocaleString("ko-KR")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Page(props: PageProps<"/student/teams/[teamId]/docs">) {
  return (
    <Suspense fallback={<Loading />}>
      <DocList params={props.params} />
    </Suspense>
  );
}
