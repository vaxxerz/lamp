"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** 교수에게 받은 초대 코드로 과목 참여 */
export function JoinCourseForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("code"));
        const { error } = await createClient().rpc("join_course", { p_invite_code: code });
        if (error) return setError(error.message);
        setError(null);
        router.refresh();
      }}
    >
      <input name="code" required placeholder="과목 초대 코드 (6자리)" className="input flex-1" />
      <button className="btn-primary">과목 참여</button>
      {error && <p className="self-center text-sm text-red-600">{error}</p>}
    </form>
  );
}

/** 아직 팀이 없을 때: 기존 팀 참여 또는 새 팀 생성 */
export function TeamPicker({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .from("teams")
      .select("id, name")
      .eq("course_id", courseId)
      .order("name")
      .then(({ data }) => setTeams(data ?? []));
  }, [courseId]);

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p;
    if (error) return setError(error.message);
    router.refresh();
  }

  const supabase = createClient();
  return (
    <div className="flex flex-col gap-2 text-sm">
      {teams.map((t) => (
        <button key={t.id} className="card text-left" onClick={() =>
            run(
              supabase.rpc("join_team", { p_team_id: t.id }).then((r) => {
                if (!r.error)
                  void fetch("/api/google/share", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ teamId: t.id }),
                  }).catch(() => {});
                return r;
              }),
            )
          }>
          {t.name} 참여하기
        </button>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name"));
          run(supabase.rpc("create_team", { p_course_id: courseId, p_name: name }));
        }}
      >
        <input name="name" required placeholder="새 팀 이름" className="input flex-1" />
        <button className="btn-primary">만들기</button>
      </form>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
