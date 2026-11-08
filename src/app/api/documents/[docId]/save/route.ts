// 문서 저장: 세션으로 작성자 확인 → 서버에서 글자 수 diff → save_document RPC (service_role)
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { countChanges } from "@/lib/diff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  baseVersion: z.number().int().positive(),
  content: z.record(z.string(), z.unknown()), // Tiptap editor.getJSON()
  contentText: z.string().max(200_000), // editor.getText()
  pastedChars: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest, ctx: RouteContext<"/api/documents/[docId]/save">) {
  const { docId } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { baseVersion, content, contentText, pastedChars } = parsed.data;

  // RLS로 읽을 수 있는 문서만 (팀원/교수). 쓰기 권한은 RPC가 팀원 여부로 재확인.
  const { data: doc } = await supabase
    .from("documents")
    .select("content_text, version")
    .eq("id", docId)
    .single();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (doc.version !== baseVersion) {
    return NextResponse.json({ error: "version_conflict", version: doc.version }, { status: 409 });
  }

  const { added, removed } = countChanges(doc.content_text, contentText);
  const { data, error } = await createAdminClient().rpc("save_document", {
    p_document_id: docId,
    p_author_id: userId,
    p_base_version: baseVersion,
    p_content: content,
    p_content_text: contentText,
    p_chars_added: added,
    p_chars_removed: removed,
    p_pasted_chars: Math.min(pastedChars, added), // 클라 보고값은 상한 처리
  });

  if (error) {
    if (error.message === "version_conflict") {
      return NextResponse.json({ error: "version_conflict" }, { status: 409 });
    }
    const status = error.message === "not_team_member" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ...data, added, removed });
}
