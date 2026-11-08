import Link from "next/link";
import { Suspense } from "react";
import { Loading, Todo } from "@/components/Todo";
import { createClient } from "@/lib/supabase/server";

async function MeetingList({ params }: { params: PageProps<"/student/teams/[teamId]/meetings">["params"] }) {
  const { teamId } = await params;
  const supabase = await createClient();
  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, held_at, location")
    .eq("team_id", teamId)
    .order("held_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <Todo owner="B">
        회의 만들기 — supabase.from(&quot;meetings&quot;).insert({"{ team_id, title, held_at, location }"}) → 회의록 문서와
        팀원 전원 출결(미체크)이 자동 생성됨
      </Todo>
      <ul className="flex flex-col gap-2">
        {(meetings ?? []).map((m) => (
          <li key={m.id}>
            <Link href={`/student/teams/${teamId}/meetings/${m.id}`} className="card block">
              {m.title}
              <span className="ml-2 text-xs text-zinc-500">
                {new Date(m.held_at).toLocaleString("ko-KR")} {m.location && `· ${m.location}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Page(props: PageProps<"/student/teams/[teamId]/meetings">) {
  return (
    <Suspense fallback={<Loading />}>
      <MeetingList params={props.params} />
    </Suspense>
  );
}
