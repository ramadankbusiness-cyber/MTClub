import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/api-error-handler";
import { cleanupExpiredFormUploads } from "@/lib/form-uploads";

function readBearer(request: Request) {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) return false;
  const provided = readBearer(request);
  if (!provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await cleanupExpiredFormUploads(50);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = withApiErrorHandling(run, "/api/cron/form-uploads");
export const POST = withApiErrorHandling(run, "/api/cron/form-uploads");
