"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "보드" },
  { href: "/docs", label: "문서" },
  { href: "/meetings", label: "회의" },
  { href: "/files", label: "파일" },
  { href: "/me", label: "내 기여" },
];

export function TeamTabs() {
  const { teamId } = useParams<{ teamId: string }>();
  const pathname = usePathname();
  const base = `/student/teams/${teamId}`;
  return (
    <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((t) => {
        const href = base + t.href;
        const active = t.href ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={t.label}
            href={href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${active ? "border-zinc-900 font-semibold dark:border-white" : "border-transparent text-zinc-500"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
