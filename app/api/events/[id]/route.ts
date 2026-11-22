import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCommittee } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth-guards";
import { eventSchema } from "@/lib/schemas";
import { writeAuditLog } from "@/lib/audit";
import { isClubCommitteeId } from "@/lib/committees";
import { applyEventQrControls, syncEventAttendanceSessions } from "@/lib/event-attendance";
import { reverseAttendancePoints, sendPointNotifications } from "@/lib/points";

type RouteContext = { params: Promise<{ id: string }> };

const eventInclude = {
  committee: { select: { id: true, name: true } },
  attendanceSessions: {
    include: {
      committee: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
      event: { select: { id: true, isOpen: true, qrAttendanceOpen: true, archivedAt: true } },
      _count: { select: { records: true } },
    },
    orderBy: { startsAt: "asc" as const },
  },
};

async function PATCHInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("events.update");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const existing = await prisma.event.findUnique({ where: { id }, select: { id: true, committeeId: true, createdById: true, archivedAt: true } });
  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (existing.archivedAt) return NextResponse.json({ error: "Archived events cannot be edited. Restore the event first." }, { status: 409 });
  if (!canAccessCommittee(access.user, existing.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the event details." }, { status: 400 });
  const committeeId = access.user.role === "LEADER" ? access.user.committeeId : parsed.data.committeeId ?? null;
  if (access.user.role === "LEADER" && committeeId !== existing.committeeId) {
    return NextResponse.json({ error: "Leaders may only edit events in their committee." }, { status: 403 });
  }
  if (committeeId && !(await isClubCommitteeId(committeeId))) {
    return NextResponse.json({ error: "Choose an existing committee." }, { status: 400 });
  }
  const isOpen = parsed.data.isOpen ?? true;
  const qrAttendanceOpen = isOpen && (parsed.data.qrAttendanceOpen ?? false);
  const event = await prisma.event.update({
    where: { id },
    data: { ...parsed.data, isOpen, qrAttendanceOpen, committeeId },
  });
  await applyEventQrControls(event.id, isOpen, qrAttendanceOpen);
  await syncEventAttendanceSessions({
    id: event.id,
    title: event.title,
    titleAr: event.titleAr,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    committeeId: event.committeeId,
    placeName: event.placeName,
    centerLat: event.centerLat,
    centerLng: event.centerLng,
    radiusMeters: event.radiusMeters,
    locationAccuracy: event.locationAccuracy,
    zoneId: event.zoneId,
    createdById: existing.createdById,
    isOpen,
    qrAttendanceOpen,
  });
  const fullEvent = await prisma.event.findUnique({ where: { id }, include: eventInclude });
  await writeAuditLog({ actorId: access.user.id, action: "event.update", targetType: "Event", targetId: id });
  return NextResponse.json({ event: fullEvent });
}

async function DELETEInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("events.delete");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== "permanent") {
    return NextResponse.json({ error: "Explicit deletion mode required. Use mode=permanent for irreversible deletion." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock Event first (consistent lock order: Event -> AttendanceSession).
      const lockedEventRows = await tx.$queryRaw<Array<{ id: string; committeeId: string | null; title: string }>>`
        SELECT id, "committeeId", title
        FROM "Event"
        WHERE id = ${id}
        FOR UPDATE
      `;
      const lockedEvent = lockedEventRows[0];
      if (!lockedEvent) return { error: "Event not found.", status: 404 as const };

      if (!canAccessCommittee(access.user, lockedEvent.committeeId)) {
        return { error: "Forbidden", status: 403 as const };
      }

      const lockedSessions = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "AttendanceSession"
        WHERE "eventId" = ${lockedEvent.id}
        ORDER BY id ASC
        FOR UPDATE
      `;
      const sessionIds = lockedSessions.map((s) => s.id);
      const pointNotifications: Awaited<ReturnType<typeof reverseAttendancePoints>> = [];

      if (sessionIds.length > 0) {
        const attendanceRecords = await tx.attendanceRecord.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true, userId: true },
          orderBy: [{ userId: "asc" }, { id: "asc" }],
        });

        for (const record of attendanceRecords) {
          const notifications = await reverseAttendancePoints(tx, {
            attendanceRecordId: record.id,
            userId: record.userId,
            eventId: lockedEvent.id,
            reasonBase: `Event permanently deleted: ${lockedEvent.title}`,
            reason: `Event permanently deleted: ${lockedEvent.title}`,
            actorId: access.user.id,
          });
          pointNotifications.push(...notifications);
        }

        // Dependent records have onDelete: Cascade from AttendanceSession in schema, but we delete explicitly for clarity and safety.
        await tx.attendanceRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.attendanceAttempt.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.qrToken.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.excuse.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.attendanceSession.deleteMany({ where: { eventId: lockedEvent.id, id: { in: sessionIds } } });
      }

      await tx.event.delete({ where: { id: lockedEvent.id } });
      return { ok: true as const, title: lockedEvent.title, pointNotifications };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

    await writeAuditLog({ actorId: access.user.id, action: "event.delete.permanent", targetType: "Event", targetId: id, details: { title: result.title } });
    await sendPointNotifications(result.pointNotifications);
    return NextResponse.json({ ok: true, mode: "permanent" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }
    throw error;
  }
}

export const PATCH = withApiErrorHandling(PATCHInternal, "/api/events/[id]");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/events/[id]");
