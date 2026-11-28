import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";

async function GETInternal() {
  const user = await requireUser();
  const agg = await prisma.pointTransaction.aggregate({ where: { userId: user.id }, _sum: { amount: true } });
  return NextResponse.json({ balance: agg._sum.amount ?? 0 });
}

export const GET = withApiErrorHandling(GETInternal, "/api/profile/points/balance");
