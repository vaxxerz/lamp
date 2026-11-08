import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

/** 현재 로그인 사용자 프로필 (없으면 null) */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", uid).single();
  return (profile as Profile) ?? null;
}

/** 역할이 맞지 않으면 리다이렉트 */
export async function requireRole(role: UserRole): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== role) redirect(profile.role === "professor" ? "/professor" : "/lamp");
  return profile;
}
