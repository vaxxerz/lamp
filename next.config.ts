import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_DEPLOYMENT_ID
      ?? process.env.VERCEL_URL
      ?? process.env.NEXT_PUBLIC_APP_VERSION
      ?? "development",
  },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Only validate segments that opt in with `export const instant`; the
    // client-fetched /lamp and /professor pages otherwise flood dev logs.
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
