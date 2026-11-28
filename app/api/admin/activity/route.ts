import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guards";
import { getAdminActivity, isActivityCategory } from "@/lib/activity";

async function GETInternal(request: Request) {
  const access = await requirePermission("audit.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const memberId = (url.searchParams.get("memberId") || "").trim() || undefined;
  const category = url.searchParams.get("category") || undefined;
  if (category && !isActivityCategory(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  const before = url.searchParams.get("before");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && Number.isNaN(new Date(from).getTime())) return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
  if (to && Number.isNaN(new Date(to).getTime())) return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const limitRaw = Number(url.searchParams.get("limit") || "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
  const result = await getAdminActivity({ memberId, category: category as import("@/lib/activity").ActivityCategory | undefined, limit, before, from, to, q });
  return NextResponse.json(result);
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/activity");
