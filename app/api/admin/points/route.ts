import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canAccessCommittee } from "@/lib/permissions";
import { z } from "zod";
import { applyManualPointTransaction, sendPointNotifications } from "@/lib/points";

const adjustSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().int().min(1).max(100000),
  reason: z.string().trim().min(1).max(500),
  action: z.enum(["ADD", "DEDUCT"]),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

async function GETInternal(request: Request) {
  const access = await requirePermission("points.view");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));

  const where: Record<string, unknown> = { isActive: true };
  if (access.user.role !== "ADMIN") {
    where.committeeId = access.user.committeeId;
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { academicNumber: { contains: q, mode: "insensitive" } },
      { clubId: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, committeeId: true, academicNumber: true, clubId: true, committee: { select: { name: true, nameAr: true } } },
    take,
    orderBy: { name: "asc" },
  });
  const userIds = users.map((u) => u.id);

  const [balances, earned, deducted, attendanceStats] = await Promise.all([
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _sum: { amount: true } }),
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: userIds }, amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: userIds }, amount: { lt: 0 } }, _sum: { amount: true } }),
    prisma.attendanceRecord.groupBy({ by: ["userId", "status"], where: { userId: { in: userIds } }, _count: { _all: true } }),
  ]);

  const balanceMap = new Map(balances.map((b) => [b.userId, b._sum.amount ?? 0]));
  const earnedMap = new Map(earned.map((b) => [b.userId, b._sum.amount ?? 0]));
  const deductedMap = new Map(deducted.map((b) => [b.userId, Math.abs(b._sum.amount ?? 0)]));
  const statsMap = new Map<string, { present: number; late: number; absent: number; excused: number }>();
  for (const row of attendanceStats) {
    const s = statsMap.get(row.userId) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    const count = row._count._all;
    if (row.status === "PRESENT") s.present += count;
    if (row.status === "LATE") s.late += count;
    if (row.status === "ABSENT") s.absent += count;
    if (row.status === "EXCUSED") s.excused += count;
    statsMap.set(row.userId, s);
  }

  const members = users.map((u) => {
    const st = statsMap.get(u.id) ?? { present: 0, late: 0, absent: 0, excused: 0 };
    const total = st.present + st.late + st.absent + st.excused;
    const attended = st.present + st.late;
    return {
      ...u,
      currentPoints: balanceMap.get(u.id) ?? 0,
      totalEarned: earnedMap.get(u.id) ?? 0,
      totalDeducted: deductedMap.get(u.id) ?? 0,
      attendance: { ...st, total, attended, percentage: total ? Math.round((attended / total) * 100) : 0 },
    };
  });

  return NextResponse.json({ members });
}

async function POSTInternal(request: Request) {
  const access = await requirePermission("points.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null);
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid points adjustment." }, { status: 400 });
  const { userId, amount, reason, action, idempotencyKey } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, committeeId: true, isActive: true } });
  if (!target || !target.isActive) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (!canAccessCommittee(access.user, target.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const signedAmount = action === "DEDUCT" ? -Math.abs(amount) : Math.abs(amount);

  try {
    const result = await prisma.$transaction(async (tx) => {
      return applyManualPointTransaction(tx, { userId, amount: signedAmount, reason, actorId: access.user.id, idempotencyKey });
    });
    if (!result.idempotent) {
      await sendPointNotifications([{ userId, amount: signedAmount, reason, balance: result.balance, actorId: access.user.id }]);
    }
    return NextResponse.json({ ok: true, balance: result.balance, transaction: result.transaction, idempotent: result.idempotent });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    const code = (e && typeof e === "object" && "code" in e) ? String((e as { code?: unknown }).code) : msg;
    if (code === "NEGATIVE_BALANCE") return NextResponse.json({ error: "Deduction would make the member balance negative." }, { status: 400 });
    if (code === "REASON_REQUIRED") return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    if (code === "INVALID_AMOUNT" || code === "REASON_TOO_LONG") return NextResponse.json({ error: "Invalid points adjustment." }, { status: 400 });
    if (code === "USER_NOT_FOUND") return NextResponse.json({ error: "Member not found." }, { status: 404 });
    throw e;
  }
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/points");
export const POST = withApiErrorHandling(POSTInternal, "/api/admin/points");
