"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({
  className = "text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
  label = "로그아웃",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <button
      className={className}
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
