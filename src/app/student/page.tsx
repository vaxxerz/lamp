import Link from "next/link";
import { Suspense } from "react";
import { Loading } from "@/components/Todo";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { JoinCourseForm, TeamPicker } from "./StudentActions";

async function StudentHome() {
  const me = await requireRole("student");
  const supabase = await createClient();
  const [{ data: courses }, { data: myTeams }] = await Promise.all([
    supabase.from("course_members").select("course:courses(id, name, semester)").eq("user_id", me.id),
    supabase.from("team_members").select("course_id, team:teams(id, name)").eq("user_id", me.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">내 팀플</h1>
      <JoinCourseForm />
      <ul className="grid gap-3 sm:grid-cols-2">
        {(courses ?? []).map(({ course }) => {
          const c = course as unknown as { id: string; name: string; semester: string };
          const team = myTeams?.find((t) => t.course_id === c.id)?.team as unknown as
            | { id: string; name: string }
            | undefined;
          return (
            <li key={c.id} className="card flex flex-col gap-2">
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="text-xs text-zinc-500">{c.semester}</p>
              </div>
              {team ? (
                <Link href={`/student/teams/${team.id}`} className="btn-primary text-center">
                  {team.name} 워크스페이스 →
                </Link>
              ) : (
                <TeamPicker courseId={c.id} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <StudentHome />
    </Suspense>
  );
}
