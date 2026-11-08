// AI 기여 분석 보고서 (docs/ANALYSIS_REPORT.md)
//  GET  ?teamId=&period=  → 캐시된 최신 보고서 (없으면 null) + 그 뒤로 새 활동이 있는지 + 다른 기간 보고서라도 있는지(hasAny)
//  POST { teamId, period } → 규칙 엔진 + LLM(OpenRouter)으로 새로 만들고 ai_reports에 저장
//  권한: 사용자 세션(RLS)으로 팀이 보여야 한다 = 그 팀 팀원 또는 담당 교수. 독자(학생/교수)는 프로필 역할로 정한다.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AI_MODEL, aiEnabled, generateAiReport } from "@/lib/analysis/ai";
import { NotVisibleError, collectAnalysisInput } from "@/lib/analysis/collect";
import { buildRulesReport, invalidEvidence } from "@/lib/analysis/rules";
import type { AnalysisReport, Audience } from "@/lib/analysis/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const Body = z.object({
  teamId: z.uuid(),
  period: z.enum(["1m", "3m", "all"]).default("3m"),
});
/** 같은 보고서를 이 시간 안에 다시 만들면 캐시를 돌려준다 (비용 · 중복 클릭 방지) */
const REGENERATE_COOLDOWN_MS = 60_000;
const noStore = { "Cache-Control": "private, no-store" };

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  const audience: Audience = profile?.role === "professor" ? "professor" : "student";
  return { supabase, uid, audience };
}

async function latest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string,
  period: string,
  audience: Audience,
) {
  const { data } = await supabase
    .from("ai_reports")
    .select("payload, created_at")
    .eq("team_id", teamId)
    .eq("scope", "team")
    .eq("period", period)
    .eq("audience", audience)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.payload ? { report: data.payload as AnalysisReport, createdAt: data.created_at as string } : null;
}

async function hasAnyReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string,
  audience: Audience,
) {
  const { data } = await supabase
    .from("ai_reports")
    .select("id")
    .eq("team_id", teamId)
    .eq("scope", "team")
    .eq("audience", audience)
    .not("payload", "is", null)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function lastActivityAt(supabase: Awaited<ReturnType<typeof createClient>>, teamId: string) {
  const { data } = await supabase
    .from("activity_events")
    .select("created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.created_at as string | undefined) ?? null;
}

export async function GET(req: NextRequest) {
  const s = await session();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse({
    teamId: req.nextUrl.searchParams.get("teamId"),
    period: req.nextUrl.searchParams.get("period") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId, period } = parsed.data;
  const { data: team } = await s.supabase.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (!team) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [cached, lastAt, anyReport] = await Promise.all([
    latest(s.supabase, teamId, period, s.audience),
    lastActivityAt(s.supabase, teamId),
    hasAnyReport(s.supabase, teamId, s.audience),
  ]);
  return NextResponse.json(
    {
      report: cached?.report ?? null,
      // 다른 기간이라도 한 번 분석한 팀이면 화면이 자동으로 새로 만들지 않는다 (토큰 비용)
      hasAny: !!cached || anyReport,
      stale: !!cached && !!lastAt && lastAt > cached.report.generatedAt,
      aiAvailable: aiEnabled(),
    },
    { headers: noStore },
  );
}

export async function POST(req: NextRequest) {
  const s = await session();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId, period } = parsed.data;

  const cached = await latest(s.supabase, teamId, period, s.audience);
  if (cached && Date.now() - Date.parse(cached.createdAt) < REGENERATE_COOLDOWN_MS && cached.report.aiStatus === "ok")
    return NextResponse.json({ report: cached.report, stale: false, aiAvailable: aiEnabled(), cached: true }, { headers: noStore });

  let input;
  try {
    input = await collectAnalysisInput(s.supabase, teamId, period);
  } catch (e) {
    if (e instanceof NotVisibleError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    console.error("ai-report collect failed", teamId, e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const rules = buildRulesReport(input, { audience: s.audience });
  let report: AnalysisReport = rules;
  let aiError: string | null = null;
  if (aiEnabled() && input.events.length) {
    const started = Date.now();
    try {
      try {
        report = await generateAiReport(input, rules);
      } catch (e) {
        // 형식이 어긋난 응답은 가끔 나온다 — 시간이 남으면 한 번만 다시 묻는다
        const retryable = e instanceof Error && (e.message === "ai_parse_failed" || e.message === "ai_truncated");
        if (!retryable || Date.now() - started > 45_000) throw e;
        console.warn("ai-report retry", teamId, e.message);
        report = await generateAiReport(input, rules);
      }
    } catch (e) {
      aiError = e instanceof Error && e.message.startsWith("ai_") ? e.message : "ai_failed";
      console.error("ai-report llm failed", teamId, e);
      report = { ...rules, aiStatus: "failed" };
    }
  }
  const bad = invalidEvidence(report, input);
  if (bad.length) {
    // mergeNarrative가 이미 걸러야 한다 — 남아 있으면 규칙 결과로 되돌린다
    console.error("ai-report invalid evidence", teamId, bad.slice(0, 5));
    report = { ...rules, aiStatus: "failed" };
  }

  // 캐시 저장 (service_role). 키가 없으면 저장 없이 돌려준다
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { error } = await admin.from("ai_reports").insert([
      {
        team_id: teamId,
        user_id: null,
        scope: "team",
        period,
        audience: s.audience,
        summary: report.team.summary,
        evidence: [],
        model: report.model,
        payload: report,
      },
      ...report.members.map((m) => ({
        team_id: teamId,
        user_id: m.userId,
        scope: "member",
        period,
        audience: s.audience,
        summary: m.summary,
        evidence: m.highlights.flatMap((h) => h.evidenceIds.map((id) => ({ event_id: id, label: h.label }))),
        model: report.model,
      })),
    ]);
    if (error) console.error("ai-report save failed", teamId, error.message);
  }

  return NextResponse.json(
    { report, stale: false, aiAvailable: aiEnabled(), model: AI_MODEL, ...(aiError ? { aiError } : {}) },
    { headers: noStore },
  );
}
