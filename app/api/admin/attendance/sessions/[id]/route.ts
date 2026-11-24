import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { writeAuditLog } from "@/lib/audit";
import { reverseAttendancePoints, sendPointNotifications } from "@/lib/points";

type RouteContext = { params: Promise<{ id: string }> };

async function GETInternal(_request: Request, context: RouteContext) {
  const adminAccess = await requirePermission("attendance.read.all");
  let actor;
  if ("error" in adminAccess) {
    const committeeAccess = await requirePermission("attendance.read.committee");
    if ("error" in committeeAccess) return NextResponse.json({ error: committeeAccess.error }, { status: committeeAccess.status });
    actor = committeeAccess.user;
  } else {
    actor = adminAccess.user;
  }
  const isAdmin = actor.role === "ADMIN";
  const { id } = await context.params;
  const session = await prisma.attendanceSession.findUnique({
    where: { id },
    include: { committee: { select: { id: true, name: true } } },
  });
  if (!session) return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });
  if (!isAdmin && session.committeeId && session.committeeId !== actor.committeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const participantFilter = isAdmin ? {} : { user: { committeeId: actor.committeeId } };
  const [records, attempts] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { sessionId: id, ...participantFilter },
      include: { user: { select: { id: true, name: true, email: true, committee: { select: { name: true } } } } },
      orderBy: { checkedInAt: "asc" },
    }),
    prisma.attendanceAttempt.findMany({
      where: { sessionId: id, ...participantFilter },
      include: { user: { select: { name: true, committee: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return NextResponse.json({ session, records, attempts });
}

async function DELETEInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("attendance.sessions.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  let body: unknown = null;
  try { body = await request.json(); } catch { body = null; }
  const reasonRaw = body && typeof body === "object" && "reason" in body ? (body as { reason?: unknown }).reason : undefined;
  const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim().slice(0, 500) : "Admin deleted attendance session";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; origin: string; eventId: string | null; title: string }>>`
        SELECT id, origin, "eventId", title
        FROM "AttendanceSession"
        WHERE id = ${id}
        FOR UPDATE
      `;
      const session = locked[0];
      if (!session) return { error: "Attendance session not found.", status: 404 as const };

      const records = await tx.attendanceRecord.findMany({
        where: { sessionId: session.id },
        select: { id: true, userId: true },
        orderBy: [{ userId: "asc" }, { id: "asc" }],
      });

      const pointNotifications: Array<Awaited<ReturnType<typeof reverseAttendancePoints>>>[number] = [];
      for (const record of records) {
        const notifications = await reverseAttendancePoints(tx, {
          attendanceRecordId: record.id,
          userId: record.userId,
          eventId: session.eventId,
          reasonBase: session.title,
          reason: `Attendance session deleted: ${session.title}`,
          actorId: access.user.id,
        });
        pointNotifications.push(...notifications);
      }

      // Delete dependents explicitly. Preserve PointTransaction ledger entries.
      await tx.attendanceAttempt.deleteMany({ where: { sessionId: session.id } });
      await tx.qrToken.deleteMany({ where: { sessionId: session.id } });
      await tx.excuse.deleteMany({ where: { sessionId: session.id } });
      await tx.attendanceRecord.deleteMany({ where: { sessionId: session.id } });
      await tx.attendanceSession.delete({ where: { id: session.id } });

      await writeAuditLog({
        actorId: access.user.id,
        action: "attendance.session.delete",
        targetType: "AttendanceSession",
        targetId: session.id,
        details: {
          title: session.title,
          reason,
          origin: session.origin,
          eventId: session.eventId,
          recordCount: records.length,
        },
      }, tx);

      return { ok: true as const, deletedSessionId: session.id, pointNotifications };
    });

    if ("error" in result) {
      const payload: Record<string, unknown> = { error: result.error };
      if ("details" in result && result.details) payload.details = result.details;
      return NextResponse.json(payload, { status: result.status });
    }

    await sendPointNotifications(result.pointNotifications);
    return NextResponse.json({ ok: true, deletedSessionId: result.deletedSessionId });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });
    }
    throw error;
  }
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/attendance/sessions/[id]");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/admin/attendance/sessions/[id]");
