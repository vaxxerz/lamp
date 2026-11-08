// 서버 전용 service_role 클라이언트 — RLS 우회. save_document / register_file_version 등
// "서버가 계산한 값"을 기록하는 RPC에만 사용. 절대 클라이언트 코드에서 import 하지 말 것.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
