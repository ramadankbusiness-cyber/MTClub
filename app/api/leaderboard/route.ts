import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

async function GETInternal(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const committeeId = url.searchParams.get("committeeId");
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));

  const where: Record<string, unknown> = { isActive: true, role: { in: ["MEMBER", "LEADER", "ADMIN"] } };
  if (committeeId) where.committeeId = committeeId;

  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, committeeId: true, committee: { select: { name: true, nameAr: true } } },
  });
  const userIds = users.map((u) => u.id);

  const [pointAgg, attAgg] = await Promise.all([
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _sum: { amount: true } }),
    prisma.attendanceRecord.groupBy({ by: ["userId", "status"], where: { userId: { in: userIds } }, _count: { _all: true } }),
  ]);
  const pointsMap = new Map(pointAgg.map((p) => [p.userId, p._sum.amount ?? 0]));
  const statsMap = new Map<string, { attended: number; total: number }>();
  for (const r of attAgg) {
    const s = statsMap.get(r.userId) ?? { attended: 0, total: 0 };
    s.total += r._count._all;
    if (r.status === "PRESENT" || r.status === "LATE") s.attended += r._count._all;
    statsMap.set(r.userId, s);
  }

  const rows = users.map((u) => {
    const st = statsMap.get(u.id) ?? { attended: 0, total: 0 };
    const totalPoints = pointsMap.get(u.id) ?? 0;
    const attendancePercentage = st.total ? Math.round((st.attended / st.total) * 100) : 0;
    return { id: u.id, name: u.name, committee: u.committee, totalPoints, attendanceCount: st.attended, attendancePercentage };
  });
  rows.sort((a, b) => b.totalPoints - a.totalPoints || b.attendancePercentage - a.attendancePercentage || a.name.localeCompare(b.name));

  const ranked = rows.slice(0, take).map((r, i) => ({ rank: i + 1, ...r }));
  return NextResponse.json({ leaderboard: ranked });
}

export const GET = withApiErrorHandling(GETInternal, "/api/leaderboard");
