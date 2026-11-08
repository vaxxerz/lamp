import type { Metadata } from "next";
import { DeploymentRefresh } from "@/components/DeploymentRefresh";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lamp — 팀플 기여도 플랫폼",
  description: "팀플의 모든 활동이 기여의 증거가 되는 협업 플랫폼",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Suspense fallback={null}><DeploymentRefresh /></Suspense>
        {children}
      </body>
    </html>
  );
}
