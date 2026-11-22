import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canAccessCommittee } from "@/lib/permissions";

async function GETInternal(request: Request) {
  const access = await requirePermission("points.view");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));
  const cursor = url.searchParams.get("cursor");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, committeeId: true, name: true } });
  if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (!canAccessCommittee(access.user, target.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [transactions, balanceAgg, earnedAgg, deductedAgg] = await Promise.all([
    prisma.pointTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        event: { select: { id: true, title: true, titleAr: true } },
        actor: { select: { id: true, name: true } },
      },
    }),
    prisma.pointTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId, amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId, amount: { lt: 0 } }, _sum: { amount: true } }),
  ]);

  return NextResponse.json({
    user: target,
    balance: balanceAgg._sum.amount ?? 0,
    totalEarned: earnedAgg._sum.amount ?? 0,
    totalDeducted: Math.abs(deductedAgg._sum.amount ?? 0),
    transactions,
    nextCursor: transactions.length === take ? transactions[transactions.length - 1]?.id ?? null : null,
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/points/transactions");
