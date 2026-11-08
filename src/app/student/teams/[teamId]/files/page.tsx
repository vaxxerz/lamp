import { Suspense } from "react";
import { Loading, Todo } from "@/components/Todo";
import { createClient } from "@/lib/supabase/server";

async function FileList({ params }: { params: PageProps<"/student/teams/[teamId]/files">["params"] }) {
  const { teamId } = await params;
  const supabase = await createClient();
  const { data: files } = await supabase
    .from("files")
    .select("id, name, latest_version, updated_at")
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <Todo owner="B">
        업로드: supabase.storage.from(&quot;team-files&quot;).upload(`{"${teamId}/${fileName}/${uuid}"}`) → POST
        /api/files/register {"{ teamId, fileName, storagePath }"}. 같은 이름이면 새 버전. 버전별 변경 요약(슬라이드 3·5 수정 등) 표시.
      </Todo>
      <ul className="flex flex-col gap-2">
        {(files ?? []).map((f) => (
          <li key={f.id} className="card">
            {f.name} <span className="text-xs text-zinc-500">v{f.latest_version}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Page(props: PageProps<"/student/teams/[teamId]/files">) {
  return (
    <Suspense fallback={<Loading />}>
      <FileList params={props.params} />
    </Suspense>
  );
}
