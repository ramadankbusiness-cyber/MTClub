import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

async function GETInternal() {
  const user = await requireUser();
  const [transactions, balanceAgg, earnedAgg, deductedAgg, eventAgg, manualAddAgg, manualDeductAgg] = await Promise.all([
    prisma.pointTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { event: { select: { id: true, title: true, titleAr: true } }, actor: { select: { name: true } } },
    }),
    prisma.pointTransaction.aggregate({ where: { userId: user.id }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId: user.id, amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId: user.id, amount: { lt: 0 } }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId: user.id, type: { in: ["EVENT_ATTENDANCE", "ATTENDANCE_ADJUSTMENT", "ATTENDANCE_REVERSAL"] }, eventId: { not: null } }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId: user.id, type: "MANUAL_ADD" }, _sum: { amount: true } }),
    prisma.pointTransaction.aggregate({ where: { userId: user.id, type: "MANUAL_DEDUCT" }, _sum: { amount: true } }),
  ]);
  return NextResponse.json({
    balance: balanceAgg._sum.amount ?? 0,
    totalEarned: earnedAgg._sum.amount ?? 0,
    totalDeducted: Math.abs(deductedAgg._sum.amount ?? 0),
    eventPoints: eventAgg._sum.amount ?? 0,
    manualAdded: manualAddAgg._sum.amount ?? 0,
    manualDeducted: Math.abs(manualDeductAgg._sum.amount ?? 0),
    transactions,
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/profile/points");
