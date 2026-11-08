import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { GoogleDocsPanel } from "@/components/google/GoogleDocsPanel";
import { LogoutButton } from "@/components/LogoutButton";
import { Loading } from "@/components/Todo";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Google Docs · Slides 연결 테스트",
  robots: { index: false },
};

const teamsSchema = z.array(z.object({
  team: z.object({ id: z.string().uuid(), name: z.string() }),
}));

type TestPageProps = PageProps<"/google-test/[[...teamPath]]">;

async function TestWorkspace({ params }: Pick<TestPageProps, "params">) {
  await connection();
  const { teamPath } = await params;
  const requestedTeam = teamPath?.[0];
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    const returnTo = requestedTeam ? `/google-test/${encodeURIComponent(requestedTeam)}` : "/google-test";
    return (
      <div className="card flex flex-col items-start gap-3">
        <p className="text-sm">Lamp 계정으로 로그인하면 Google 파일을 팀에 연결할 수 있습니다.</p>
        <Link href={{ pathname: "/login", query: { next: returnTo } }} className="btn-primary inline-flex min-h-11 items-center">
          로그인
        </Link>
      </div>
    );
  }

  const { data, error } = await supabase
    .from("team_members")
    .select("team:teams!inner(id, name)")
    .eq("user_id", userId);
  const memberships = teamsSchema.safeParse(data);

  if (error || !memberships.success) {
    return <p role="alert" className="card text-sm">팀을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>;
  }

  const teams = memberships.data.map(({ team }) => team);
  const selectedTeam = requestedTeam
    ? teams.find(({ id }) => id === requestedTeam)
    : teams.length === 1 ? teams[0] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <p className="min-w-0 break-all text-sm">{auth.claims.email ?? "로그인됨"}</p>
        <div className="flex min-h-11 items-center"><LogoutButton /></div>
      </div>
      {teams.length === 0 ? (
        <div className="card flex flex-col items-start gap-3">
          <p className="text-sm">파일을 연결하려면 학생 계정으로 팀에 참여해 주세요.</p>
          <Link href="/lamp" className="btn-primary inline-flex min-h-11 items-center">내 팀플</Link>
        </div>
      ) : (
        <>
          {teams.length > 1 || !selectedTeam ? (
            <nav aria-label="테스트 팀" className="flex flex-wrap gap-2">
              {teams.map(({ id, name }) => (
                <Link
                  key={id}
                  href={`/google-test/${id}`}
                  aria-current={selectedTeam?.id === id ? "page" : undefined}
                  className="card inline-flex min-h-11 min-w-0 items-center px-3 py-2 text-sm [overflow-wrap:anywhere] hover:bg-zinc-100 aria-[current=page]:font-semibold dark:hover:bg-zinc-900"
                >
                  {name}
                </Link>
              ))}
            </nav>
          ) : null}
          {selectedTeam ? (
            <>
              <p className="break-words text-sm">연결할 팀 <strong>{selectedTeam.name}</strong></p>
              <GoogleDocsPanel key={selectedTeam.id} teamId={selectedTeam.id} />
            </>
          ) : (
            <p className="text-sm">{requestedTeam ? "참여 중인 팀에서 다시 선택해 주세요." : "파일을 연결할 팀을 선택해 주세요."}</p>
          )}
        </>
      )}
    </div>
  );
}

export default function GoogleTestPage({ params }: TestPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold break-keep">Google Docs · Slides 연결 테스트</h1>
        <p className="break-keep text-sm text-zinc-600 dark:text-zinc-400">파일을 연결한 뒤 수정 이력을 확인하세요.</p>
      </header>
      <Suspense fallback={<Loading />}>
        <TestWorkspace params={params} />
      </Suspense>
    </main>
  );
}
