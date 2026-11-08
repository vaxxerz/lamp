import { connection } from "next/server";
import { APP_VERSION } from "@/lib/deployment-version";

export async function GET() {
  await connection();
  return Response.json({ version: APP_VERSION }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}
