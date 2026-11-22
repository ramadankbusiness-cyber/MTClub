import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { manualAttendanceSchema } from "@/lib/schemas";
import { canAccessCommittee } from "@/lib/permissions";
import { syncAttendancePoints, reverseAttendancePoints, sendPointNotifications } from "@/lib/points";

type RouteContext = { params: Promise<{ id: string }> };

async function POSTInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("attendance.manualMark");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = manualAttendanceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a member, attendance status, and reason." }, { status: 400 });
  const { id: sessionId } = await context.params;
  const [session, member] = await Promise.all([
    prisma.attendanceSession.findUnique({ where: { id: sessionId }, select: { id: true, committeeId: true, eventId: true, title: true, event: { select: { id: true, archivedAt: true, title: true } } } }),
    prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, committeeId: true } }),
  ]);
  if (!session) return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });
  if (!canAccessCommittee(access.user, session.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Archived events: manual correction allowed for authorized admins; QR/self-service blocked elsewhere.
  if (!member || (session.committeeId && member.committeeId !== session.committeeId)) {
    return NextResponse.json({ error: "Choose an eligible member for this session." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.attendanceRecord.upsert({
      where: { userId_sessionId: { userId: member.id, sessionId } },
      create: {
        userId: member.id, sessionId, status: parsed.data.status,
        reason: parsed.data.reason, markedById: access.user.id,
        checkedInAt: parsed.data.status === "PRESENT" || parsed.data.status === "LATE" ? new Date() : null,
      },
      update: {
        status: parsed.data.status, reason: parsed.data.reason, markedById: access.user.id,
        checkedInAt: parsed.data.status === "PRESENT" || parsed.data.status === "LATE" ? new Date() : null,
        distanceMeters: null, accuracyMeters: null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    await tx.auditLog.create({
      data: {
        actorId: access.user.id,
        action: "attendance.manual.mark",
        targetType: "AttendanceRecord",
        targetId: record.id,
        details: { sessionId, userId: member.id, status: record.status, reason: parsed.data.reason },
      },
    });
    const pointNotifications = await syncAttendancePoints(tx, {
      attendanceRecordId: record.id,
      userId: member.id,
      sessionId,
      newStatus: parsed.data.status,
      actorId: access.user.id,
    });
    return { record, pointNotifications };
  });

  await sendPointNotifications(result.pointNotifications);
  return NextResponse.json({ record: result.record });
}

async function DELETEInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("attendance.manualMark");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id: sessionId } = await context.params;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId }, select: { id: true, committeeId: true, eventId: true, title: true, event: { select: { id: true, title: true } } } });
  if (!session) return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });
  if (!canAccessCommittee(access.user, session.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.attendanceRecord.findUnique({ where: { userId_sessionId: { userId, sessionId } } });
  if (!existing) return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const pointNotifications = await reverseAttendancePoints(tx, {
      attendanceRecordId: existing.id,
      userId,
      eventId: session.eventId ?? session.event?.id ?? null,
      reasonBase: session.event?.title ?? session.title,
      actorId: access.user.id,
    });
    await tx.attendanceRecord.delete({ where: { id: existing.id } });
    await tx.auditLog.create({
      data: {
        actorId: access.user.id,
        action: "attendance.manual.delete",
        targetType: "AttendanceRecord",
        targetId: existing.id,
        details: { sessionId, userId },
      },
    });
    return { pointNotifications };
  });

  await sendPointNotifications(result.pointNotifications);
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/admin/attendance/sessions/[id]/records");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/admin/attendance/sessions/[id]/records");
