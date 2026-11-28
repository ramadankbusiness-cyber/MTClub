import { withApiErrorHandling } from "@/lib/api-error-handler";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchBirthdayNotifications } from "@/lib/birthdays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !authorization.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function run(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await dispatchBirthdayNotifications();
  return NextResponse.json(result);
}

export const POST = withApiErrorHandling(run, "/api/cron/birthdays");
export const GET = withApiErrorHandling(run, "/api/cron/birthdays");
