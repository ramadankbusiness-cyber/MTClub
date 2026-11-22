import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCommittee } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth-guards";
import { writeAuditLog } from "@/lib/audit";

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

async function POSTInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("events.delete");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;

  const existing = await prisma.event.findUnique({
    where: { id },
    select: { id: true, committeeId: true, archivedAt: true, title: true },
  });
  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (!canAccessCommittee(access.user, existing.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (existing.archivedAt) return NextResponse.json({ error: "Event is already archived." }, { status: 409 });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id },
      data: { archivedAt: now, isOpen: false, qrAttendanceOpen: false },
    });
    await tx.attendanceSession.updateMany({
      where: { eventId: id },
      data: { qrEnabled: false },
    });
    const sessions = await tx.attendanceSession.findMany({ where: { eventId: id }, select: { id: true } });
    if (sessions.length) {
      await tx.qrToken.updateMany({
        where: { sessionId: { in: sessions.map((s) => s.id) }, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
    }
  });

  const fullEvent = await prisma.event.findUnique({ where: { id }, include: eventInclude });
  await writeAuditLog({ actorId: access.user.id, action: "event.archive", targetType: "Event", targetId: id, details: { title: existing.title } });
  return NextResponse.json({ event: fullEvent, archived: true });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/events/[id]/archive");
