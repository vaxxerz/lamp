// 파일 버전 등록: 클라이언트가 Storage(team-files/{teamId}/...)에 직접 업로드한 뒤 호출.
// 서버가 파일을 내려받아 텍스트 추출 → 이전 버전과 비교 → register_file_version RPC
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { countChanges, diffSlides } from "@/lib/diff";
import { extractText, SLIDE_SEPARATOR } from "@/lib/extract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({
  teamId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  storagePath: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { teamId, fileName, storagePath } = parsed.data;
  if (!storagePath.startsWith(`${teamId}/`)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: blob, error: dlError } = await admin.storage.from("team-files").download(storagePath);
  if (dlError || !blob) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

  const extension = fileName.includes(".") ? fileName.split(".").pop()! : null;
  const extracted = await extractText(Buffer.from(await blob.arrayBuffer()), extension);

  // 직전 버전 텍스트
  const { data: prev } = await admin
    .from("file_versions")
    .select("extracted_text, files!inner(team_id, name)")
    .eq("files.team_id", teamId)
    .eq("files.name", fileName)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevText = prev?.extracted_text ?? "";
  const { added, removed } = extracted ? countChanges(prevText, extracted.text) : { added: 0, removed: 0 };
  const summary = extracted?.slides
    ? diffSlides(prevText ? prevText.split(SLIDE_SEPARATOR) : [], extracted.slides)
    : {};

  const { data, error } = await admin.rpc("register_file_version", {
    p_team_id: teamId,
    p_uploader_id: userId,
    p_file_name: fileName,
    p_storage_path: storagePath,
    p_mime_type: blob.type || null,
    p_size_bytes: blob.size,
    p_extracted_text: extracted?.text ?? null,
    p_chars_added: added,
    p_chars_removed: removed,
    p_change_summary: summary,
  });
  if (error) {
    const status = error.message === "not_team_member" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ...data, added, removed, summary });
}
