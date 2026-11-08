import { Suspense } from "react";
import { ContributionTable } from "@/components/ContributionTable";
import { Loading, Todo } from "@/components/Todo";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Contribution } from "@/lib/types";

async function MyContribution({ params }: { params: PageProps<"/student/teams/[teamId]/me">["params"] }) {
  const { teamId } = await params;
  const [supabase, me] = await Promise.all([createClient(), getCurrentProfile()]);
  const { data } = await supabase.rpc("get_team_contributions", { p_team_id: teamId });
  const mine = ((data ?? []) as Contribution[]).filter((c) => c.user_id === me?.id);

  return (
    <div className="flex flex-col gap-4">
      <ContributionTable rows={mine} showPeer={false} />
      <Todo owner="B">내 활동 타임라인 (activity_events where user_id = 나) + 팀원 활동에 👍 kudos 버튼</Todo>
    </div>
  );
}

export default function Page(props: PageProps<"/student/teams/[teamId]/me">) {
  return (
    <Suspense fallback={<Loading />}>
      <MyContribution params={props.params} />
    </Suspense>
  );
}
