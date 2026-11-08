"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { APP_VERSION } from "@/lib/deployment-version";
import { watchDeployment } from "@/lib/deployment-refresh";

export function DeploymentRefresh() {
  const pathname = usePathname();
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return watchDeployment(APP_VERSION);
  }, [pathname]);
  return null;
}
