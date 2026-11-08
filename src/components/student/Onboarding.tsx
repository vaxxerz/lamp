"use client";
// 팀 시작 화면 — 투트랙
//  1트랙 독립 팀플: 과목 코드 없이 학생끼리 (팀 만들기 → 팀 초대코드 공유 / 코드로 합류). 교수 열람 없음.
//  2트랙 과목 팀플: 교수에게 받은 과목 코드로 참여 → 팀 참여 · 만들기. 교수가 기여를 함께 봄.
// 팀이 없으면 첫 화면으로, 이미 팀이 있으면 NewTeamDialog(팝업)로 팀을 더 추가할 때 쓴다.
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { GraduationCap, KeyRound, Plus, UsersRound, X } from "lucide-react";
import { createIndependentTeam, joinTeamByCode, loadJoinableCourses } from "@/lib/student/live";
import { useStudent } from "./StudentProvider";
import { PageHeading } from "./ui";
import { Dialog } from "./Dialog";

type Course = Awaited<ReturnType<typeof loadJoinableCourses>>[number];

const value = (e: FormEvent<HTMLFormElement>, name: string) => String(new FormData(e.currentTarget).get(name) ?? "").trim();

/** 이미 팀이 있을 때 — 새 팀 만들기 · 참여를 페이지 이동 없이 팝업으로 */
export function NewTeamDialog({ close }: { close: () => void }) {
  return (
    <Dialog close={close} labelId="new-team-title">
      <section className="lamp-modal lamp-modal-wide">
        <div className="lamp-modal-head">
          <h2 id="new-team-title">새 팀 만들기 · 참여</h2>
          <button autoFocus className="lamp-icon-button" aria-label="닫기" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <p className="lamp-muted">친구들끼리 바로 시작하거나, 수업 과목 코드로 교수님과 함께 쓸 수 있어요.</p>
        <Onboarding onDone={close} />
      </section>
    </Dialog>
  );
}

export function Onboarding({ onDone }: { onDone?: () => void } = {}) {
  const { supabase, noTeam, ws, selectTeam } = useStudent();
  const router = useRouter();
  const userId = noTeam?.userId ?? (ws.mode === "live" ? ws.me.id : null);
  const name = noTeam?.name ?? (ws.mode === "live" ? ws.me.name : "");
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    if (userId)
      loadJoinableCourses(supabase, userId)
        .then((c) => active && setCourses(c))
        .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [supabase, userId]);

  /** 실행 → 새 팀으로 전환 → 대시보드 */
  async function run(op: () => Promise<string | null | void>) {
    setPending(true);
    setError("");
    try {
      const teamId = await op();
      if (teamId) {
        void fetch("/api/google/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId }),
        }).catch(() => {}); // 구글 문서 자동 공유 (실패해도 참여는 유지)
        await selectTeam(teamId);
        onDone?.();
        router.push("/lamp/dashboard");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function joinCourse(code: string) {
    const { error } = await supabase.rpc("join_course", { p_invite_code: code });
    if (error) throw new Error(error.message);
    if (userId) setCourses(await loadJoinableCourses(supabase, userId));
  }

  async function rpcTeam(fn: string, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as string | null;
  }

  return (
    <>
      {!onDone && (
        <PageHeading
          title={name ? `${name}님, 어떤 팀플을 시작할까요?` : "어떤 팀플을 시작할까요?"}
          description="친구들끼리 바로 시작할 수도 있고, 수업 과목 코드로 교수님과 함께 쓸 수도 있어요. 두 가지 팀에 동시에 속할 수 있어요."
        />
      )}

      <div className="lamp-track-grid">
        {/* ---------- 1트랙 ---------- */}
        <section className="lamp-card lamp-connect lamp-track">
          <div className="lamp-connect-title">
            <span className="lamp-soft-icon">
              <UsersRound size={22} />
            </span>
            <div>
              <h2>친구들과 팀플 시작하기</h2>
              <p>과목 코드 없이 우리끼리 팀을 만들고 기여를 기록해요. 팀 초대코드로 팀원을 불러요.</p>
            </div>
          </div>
          <form
            className="lamp-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              const team = value(e, "name");
              void run(async () => (await createIndependentTeam(supabase, team)).team_id);
            }}
          >
            <input name="name" required maxLength={50} className="lamp-input" placeholder="팀 이름 (예: 캡스톤 3조)" />
            <button className="lamp-button" disabled={pending}>
              <Plus size={16} />팀 만들기
            </button>
          </form>
          <form
            className="lamp-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              const code = value(e, "code");
              void run(() => joinTeamByCode(supabase, code));
            }}
          >
            <input name="code" required maxLength={12} className="lamp-input" placeholder="팀 초대코드 6자리" />
            <button className="lamp-button secondary" disabled={pending}>
              <KeyRound size={16} />
              코드로 합류
            </button>
          </form>
        </section>

        {/* ---------- 2트랙 ---------- */}
        <section className="lamp-card lamp-connect lamp-track">
          <div className="lamp-connect-title">
            <span className="lamp-soft-icon">
              <GraduationCap size={22} />
            </span>
            <div>
              <span className="lamp-badge verified">교수 열람</span>
              <h2>과목 코드로 참여하기</h2>
              <p>교수님께 받은 과목 코드로 들어가 팀을 만들거나 합류해요. 교수님이 팀 기여를 함께 봐요.</p>
            </div>
          </div>
          <form
            className="lamp-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              const code = value(e, "course");
              void run(() => joinCourse(code));
            }}
          >
            <input name="course" required maxLength={12} className="lamp-input" placeholder="과목 코드 6자리" />
            <button className="lamp-button" disabled={pending}>
              과목 참여
            </button>
          </form>
          {courses.map((c) => (
            <div key={c.id} className="lamp-track-course">
              <strong>{c.name}</strong> <span className="lamp-muted">{c.semester}</span>
              <div className="lamp-team-members">
                {c.teams.map((t) => (
                  <button
                    key={t.id}
                    className="lamp-button secondary"
                    disabled={pending}
                    onClick={() => void run(async () => (await rpcTeam("join_team", { p_team_id: t.id }), t.id))}
                  >
                    {t.name} 합류
                  </button>
                ))}
              </div>
              <form
                className="lamp-input-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const team = value(e, "team");
                  void run(() => rpcTeam("create_team", { p_course_id: c.id, p_name: team }));
                }}
              >
                <input name="team" required maxLength={50} className="lamp-input" placeholder="이 과목에서 새 팀 이름" />
                <button className="lamp-button" disabled={pending}>
                  <Plus size={16} />팀 만들기
                </button>
              </form>
            </div>
          ))}
        </section>
      </div>
      {error && (
        <p className="lamp-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
