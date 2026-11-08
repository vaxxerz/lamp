import { Suspense } from "react";
import { Loading, Todo } from "@/components/Todo";
import { createClient } from "@/lib/supabase/server";
import { ATTENDANCE_LABEL, type AttendanceStatus } from "@/lib/types";

type Params = PageProps<"/student/teams/[teamId]/meetings/[meetingId]">["params"];

async function Meeting({ params }: { params: Params }) {
  const { meetingId } = await params;
  const supabase = await createClient();
  const [{ data: meeting }, { data: attendance }, { data: comments }] = await Promise.all([
    supabase.from("meetings").select("title, held_at, location, document_id").eq("id", meetingId).single(),
    supabase
      .from("meeting_attendance")
      .select("user_id, status, comment, member:profiles!meeting_attendance_user_id_fkey(name)")
      .eq("meeting_id", meetingId),
    supabase
      .from("meeting_comments")
      .select("id, body, created_at, author:profiles!meeting_comments_author_id_fkey(name)")
      .eq("meeting_id", meetingId)
      .order("created_at"),
  ]);
  if (!meeting) return <p>회의를 찾을 수 없어요.</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{meeting.title}</h1>
      <section className="card">
        <h2 className="mb-2 font-semibold">출결</h2>
        <table className="w-full text-sm">
          <tbody>
            {(attendance ?? []).map((a) => (
              <tr key={a.user_id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1.5">{(a.member as unknown as { name: string }).name}</td>
                <td>{ATTENDANCE_LABEL[a.status as AttendanceStatus]}</td>
                <td className="text-zinc-500">{a.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Todo owner="B">
          상태 드롭다운 + 한 줄 코멘트 입력 — update meeting_attendance set status, comment (본인 상태는 다른 팀원만 변경 가능)
        </Todo>
      </section>
      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">코멘트</h2>
        {(comments ?? []).map((c) => (
          <p key={c.id} className="text-sm">
            <b>{(c.author as unknown as { name: string }).name}</b> {c.body}
          </p>
        ))}
        <Todo owner="B">코멘트 입력 — insert meeting_comments {"{ meeting_id, body }"}</Todo>
      </section>
      <Todo owner="B">회의록: 문서 에디터 컴포넌트 재사용 (document_id = {meeting.document_id})</Todo>
    </div>
  );
}

export default function Page(props: PageProps<"/student/teams/[teamId]/meetings/[meetingId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Meeting params={props.params} />
    </Suspense>
  );
}
