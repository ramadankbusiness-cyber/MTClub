import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guards";
import { getMemberActivity, isActivityCategory } from "@/lib/activity";

async function GETInternal(request: Request) {
  const access = await requirePermission("profile.read.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const category = url.searchParams.get("category") || undefined;
  if (category && !isActivityCategory(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  const before = url.searchParams.get("before");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const limitRaw = Number(url.searchParams.get("limit") || "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
  const result = await getMemberActivity({ userId: access.user.id, category: category as import("@/lib/activity").ActivityCategory | undefined, limit, before, q });
  return NextResponse.json(result);
}

export const GET = withApiErrorHandling(GETInternal, "/api/activity");
