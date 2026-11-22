import { prisma } from "@/lib/prisma";
import type { Prisma, PointTransactionType } from "@/lib/generated/prisma";
import { createImmediateNotification } from "@/lib/notification-delivery";

type Tx = Prisma.TransactionClient;

export type PointsNotification = {
  userId: string;
  amount: number;
  reason: string;
  eventTitle?: string | null;
  balance: number;
  actorId?: string | null;
};

export class PointsError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export function eligibleAttendancePoints(status: string, eventAttendancePoints: number | null | undefined) {
  if (status === "PRESENT" || status === "LATE") return Math.max(0, Math.floor(eventAttendancePoints ?? 0));
  return 0;
}

export async function getUserPointBalance(db: Tx | typeof prisma, userId: string) {
  const agg = await db.pointTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export async function lockUserPoints(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`points:${userId}`}))`;
}

async function getAttendanceNet(tx: Tx, attendanceRecordId: string) {
  const rows = await tx.pointTransaction.findMany({
    where: {
      attendanceRecordId,
      type: { in: ["EVENT_ATTENDANCE", "ATTENDANCE_ADJUSTMENT", "ATTENDANCE_REVERSAL"] },
    },
    select: { id: true, amount: true, type: true },
    orderBy: { createdAt: "asc" },
  });
  const net = rows.reduce((sum, r) => sum + r.amount, 0);
  return { net, count: rows.length, rows };
}

async function insertPointTx(
  tx: Tx,
  data: {
    userId: string;
    amount: number;
    reason: string;
    type: PointTransactionType;
    eventId?: string | null;
    attendanceRecordId?: string | null;
    actorId?: string | null;
    dedupeKey: string;
  },
) {
  if (!Number.isInteger(data.amount) || data.amount === 0) {
    return { created: false as const, duplicate: false };
  }
  // Safe idempotent insert: ON CONFLICT on dedupeKey does not abort the PG transaction.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "PointTransaction" ("id", "userId", "amount", "reason", "type", "eventId", "attendanceRecordId", "actorId", "dedupeKey", "createdAt")
    VALUES (${crypto.randomUUID()}, ${data.userId}, ${data.amount}, ${data.reason}, ${data.type}::"PointTransactionType", ${data.eventId ?? null}, ${data.attendanceRecordId ?? null}, ${data.actorId ?? null}, ${data.dedupeKey}, NOW())
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING "id"
  `;
  if (rows.length > 0) return { created: true as const, duplicate: false, id: rows[0].id };
  // A conflict occurred - only treat as idempotent if it's the same dedupeKey.
  const existing = await tx.pointTransaction.findUnique({ where: { dedupeKey: data.dedupeKey }, select: { id: true, dedupeKey: true } });
  if (existing) return { created: false as const, duplicate: true, id: existing.id };
  throw new PointsError("DEDUPE_CONFLICT", "Unique constraint conflict was not caused by dedupeKey.");
}

export async function syncAttendancePoints(
  tx: Tx,
  input: {
    attendanceRecordId: string;
    userId: string;
    sessionId: string;
    newStatus: string;
    actorId?: string | null;
  },
): Promise<PointsNotification[]> {
  if (!input.attendanceRecordId || !input.userId || !input.sessionId) {
    throw new PointsError("INVALID_INPUT", "Missing attendance synchronization identifiers.");
  }

  const record = await tx.attendanceRecord.findUnique({
    where: { id: input.attendanceRecordId },
    select: { id: true, userId: true, sessionId: true, status: true },
  });
  if (!record) throw new PointsError("ATTENDANCE_RECORD_NOT_FOUND", "Attendance record not found.");
  if (record.userId !== input.userId) throw new PointsError("ATTENDANCE_USER_MISMATCH", "Attendance record user mismatch.");
  if (record.sessionId !== input.sessionId) throw new PointsError("ATTENDANCE_SESSION_MISMATCH", "Attendance record session mismatch.");

  const session = await tx.attendanceSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      eventId: true,
      title: true,
      event: { select: { id: true, title: true, titleAr: true, attendancePoints: true } },
    },
  });
  if (!session) throw new PointsError("ATTENDANCE_SESSION_NOT_FOUND", "Attendance session not found.");

  // Validate event/session relationship: if session has eventId, event relation must be consistent.
  const eventId = session.eventId ?? session.event?.id ?? null;
  if (session.eventId && session.event && session.event.id !== session.eventId) {
    throw new PointsError("ATTENDANCE_EVENT_MISMATCH", "Attendance session event relationship is invalid.");
  }

  await lockUserPoints(tx, record.userId);

  const eventPoints = session.event?.attendancePoints ?? 0;
  const earningStatus = input.newStatus === "PRESENT" || input.newStatus === "LATE";
  // If event relationship is missing/deleted, do not create new earning awards; still allow reversal to 0.
  const desired = earningStatus && !session.event ? 0 : eligibleAttendancePoints(input.newStatus, eventPoints);
  const reasonBase = session.event?.title ? `Attendance: ${session.event.title}` : `Attendance: ${session.title}`;

  const { net: currentNet, count } = await getAttendanceNet(tx, record.id);
  const difference = desired - currentNet;

  if (difference === 0) return [];

  const dedupeKey = `attendance:${record.id}:sync:${count}:${desired}:${currentNet}`;
  const type: PointTransactionType = difference > 0
    ? (currentNet === 0 ? "EVENT_ATTENDANCE" : "ATTENDANCE_ADJUSTMENT")
    : "ATTENDANCE_REVERSAL";

  const reason = difference > 0
    ? (currentNet === 0 ? reasonBase : `Attendance adjustment: ${reasonBase}`)
    : `Attendance reversal: ${reasonBase}`;

  const result = await insertPointTx(tx, {
    userId: record.userId,
    amount: difference,
    reason,
    type,
    eventId,
    attendanceRecordId: record.id,
    actorId: input.actorId ?? null,
    dedupeKey,
  });

  if (!result.created) return [];

  const balance = await getUserPointBalance(tx, record.userId);
  return [{ userId: record.userId, amount: difference, reason, eventTitle: session.event?.title ?? session.title, balance, actorId: input.actorId ?? null }];
}

export async function reverseAttendancePoints(
  tx: Tx,
  input: { attendanceRecordId: string; userId: string; eventId?: string | null; reasonBase: string; reason?: string; actorId?: string | null },
): Promise<PointsNotification[]> {
  if (!input.attendanceRecordId || !input.userId) {
    throw new PointsError("INVALID_INPUT", "Missing attendance reversal identifiers.");
  }

  const record = await tx.attendanceRecord.findUnique({
    where: { id: input.attendanceRecordId },
    select: { id: true, userId: true },
  });
  // If record is already deleted, we can still try to reverse by attendanceRecordId; but we must be safe.
  const targetUserId = record?.userId ?? input.userId;
  if (record && record.userId !== input.userId) {
    throw new PointsError("ATTENDANCE_USER_MISMATCH", "Attendance record user mismatch.");
  }

  await lockUserPoints(tx, targetUserId);

  const { net, count } = await getAttendanceNet(tx, input.attendanceRecordId);
  if (net === 0) return [];

  const amount = -net;
  const dedupeKey = `attendance:${input.attendanceRecordId}:sync:${count}:0:${net}`;
  const reason = input.reason ?? `Attendance reversal: ${input.reasonBase}`;
  const result = await insertPointTx(tx, {
    userId: targetUserId,
    amount,
    reason,
    type: "ATTENDANCE_REVERSAL",
    eventId: input.eventId ?? null,
    attendanceRecordId: input.attendanceRecordId,
    actorId: input.actorId ?? null,
    dedupeKey,
  });
  if (!result.created) return [];

  const balance = await getUserPointBalance(tx, targetUserId);
  return [{ userId: targetUserId, amount, reason, eventTitle: input.reasonBase, balance, actorId: input.actorId ?? null }];
}

export async function applyManualPointTransaction(
  tx: Tx,
  input: { userId: string; amount: number; reason: string; actorId: string },
) {
  if (!input.actorId) throw new PointsError("INVALID_ACTOR", "Actor is required.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new PointsError("REASON_REQUIRED", "Reason is required.");
  if (reason.length > 500) throw new PointsError("REASON_TOO_LONG", "Reason is too long.");

  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new PointsError("INVALID_AMOUNT", "Amount must be a finite integer.");
  }
  if (amount === 0) throw new PointsError("INVALID_AMOUNT", "Amount cannot be zero.");
  const abs = Math.abs(amount);
  if (abs > 100000) throw new PointsError("INVALID_AMOUNT", "Amount exceeds allowed limit.");

  const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true } });
  if (!target) throw new PointsError("USER_NOT_FOUND", "User not found.");

  await lockUserPoints(tx, input.userId);
  const current = await getUserPointBalance(tx, input.userId);
  const next = current + amount;
  if (next < 0) throw new PointsError("NEGATIVE_BALANCE", "Deduction would make balance negative.");

  const id = crypto.randomUUID();
  const type: PointTransactionType = amount > 0 ? "MANUAL_ADD" : "MANUAL_DEDUCT";
  const dedupeKey = `manual:${id}:${input.userId}:${amount}`;
  const created = await insertPointTx(tx, {
    userId: input.userId,
    amount,
    reason,
    type,
    actorId: input.actorId,
    dedupeKey,
  });
  if (!created.created) throw new PointsError("DUPLICATE_TRANSACTION", "Duplicate manual transaction.");

  const txRow = await tx.pointTransaction.findUnique({ where: { dedupeKey } });
  return { transaction: txRow, balance: next };
}

export async function sendPointNotifications(notifications: PointsNotification[]) {
  for (const n of notifications) {
    const positive = n.amount > 0;
    const sign = positive ? `+${n.amount}` : `${n.amount}`;
    await createImmediateNotification({
      title: positive ? "Points Added" : "Points Deducted",
      titleAr: positive ? "تمت إضافة نقاط" : "تم خصم نقاط",
      message: `${sign} points have been ${positive ? "added to" : "deducted from"} your account. Reason: ${n.reason}. Current balance: ${n.balance} points.`,
      messageAr: `${sign} نقطة تم ${positive ? "إضافتها إلى" : "خصمها من"} حسابك. السبب: ${n.reason}. الرصيد الحالي: ${n.balance} نقطة.`,
      link: "/profile",
      type: positive ? "POINTS_ADDED" : "POINTS_DEDUCTED",
      audience: "USERS",
      committeeId: null,
      createdById: n.actorId ?? null,
      userIds: [n.userId],
    }).catch((err) => console.error("[points] notification failed", err));
  }
}
