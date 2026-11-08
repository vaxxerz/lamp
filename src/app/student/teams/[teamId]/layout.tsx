import { Suspense } from "react";
import { TeamTabs } from "./TeamTabs";

export default function TeamLayout({ children }: LayoutProps<"/student/teams/[teamId]">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <TeamTabs />
      </Suspense>
      {children}
    </div>
  );
}
