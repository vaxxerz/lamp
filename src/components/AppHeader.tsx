import Link from "next/link";
import { Suspense } from "react";
import { getCurrentProfile } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

async function UserBox() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span>
        {profile.name}
        <span className="ml-1 text-zinc-500">({profile.role === "professor" ? "교수" : "학생"})</span>
      </span>
      <LogoutButton />
    </div>
  );
}

export function AppHeader({ home }: { home: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <Link href={home} className="font-bold">
        Lamp.
      </Link>
      <Suspense fallback={null}>
        <UserBox />
      </Suspense>
    </header>
  );
}
