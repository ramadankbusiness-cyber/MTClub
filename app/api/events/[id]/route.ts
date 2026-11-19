import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCommittee } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth-guards";
import { eventSchema } from "@/lib/schemas";
import { writeAuditLog } from "@/lib/audit";
import { isClubCommitteeId } from "@/lib/committees";
import { applyEventQrControls, syncEventAttendanceSessions } from "@/lib/event-attendance";

type RouteContext = { params: Promise<{ id: string }> };

const eventInclude = {
  committee: { select: { id: true, name: true } },
  attendanceSessions: {
    include: {
      committee: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
      event: { select: { id: true, isOpen: true, qrAttendanceOpen: true } },
      _count: { select: { records: true } },
    },
    orderBy: { startsAt: "asc" as const },
  },
};

async function PATCHInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("events.update");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const existing = await prisma.event.findUnique({ where: { id }, select: { id: true, committeeId: true, createdById: true } });
  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
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

async function DELETEInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("events.delete");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  try {
    await prisma.event.delete({ where: { id } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }
    throw error;
  }
  await writeAuditLog({ actorId: access.user.id, action: "event.delete", targetType: "Event", targetId: id });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrorHandling(PATCHInternal, "/api/events/[id]");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/events/[id]");
