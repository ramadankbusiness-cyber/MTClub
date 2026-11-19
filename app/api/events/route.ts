import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, requirePermission } from "@/lib/auth-guards";
import { eventSchema } from "@/lib/schemas";
import { writeAuditLog } from "@/lib/audit";
import { createImmediateNotification } from "@/lib/notification-delivery";
import { isClubCommitteeId } from "@/lib/committees";
import { applyEventQrControls, syncEventAttendanceSessions } from "@/lib/event-attendance";

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

async function GETInternal(request: Request) {
  const user = await getCurrentUser();
  const manage = new URL(request.url).searchParams.get("manage") === "true";
  if (manage) {
    const access = await requirePermission("events.create");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    const events = await prisma.event.findMany({
      where: access.user.role === "ADMIN" ? {} : { committeeId: access.user.committeeId },
      include: eventInclude,
      orderBy: { startsAt: "desc" },
    });
    return NextResponse.json({ events });
  }
  const events = await prisma.event.findMany({
    where: { published: true },
    orderBy: { startsAt: "asc" },
    take: 100,
    include: { committee: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ events, authenticated: !!user?.isActive });
}

async function POSTInternal(request: Request) {
  const access = await requirePermission("events.create");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the event details." }, { status: 400 });
  const committeeId = access.user.role === "LEADER" ? access.user.committeeId : parsed.data.committeeId ?? null;
  if (access.user.role === "LEADER" && !committeeId) return NextResponse.json({ error: "Your account must be assigned to a committee." }, { status: 403 });
  if (committeeId && !(await isClubCommitteeId(committeeId))) {
    return NextResponse.json({ error: "Choose an existing committee." }, { status: 400 });
  }
  const isOpen = parsed.data.isOpen ?? true;
  const qrAttendanceOpen = isOpen && (parsed.data.qrAttendanceOpen ?? false);
  const event = await prisma.event.create({
    data: { ...parsed.data, isOpen, qrAttendanceOpen, committeeId, createdById: access.user.id },
  });
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
    createdById: access.user.id,
    isOpen,
    qrAttendanceOpen,
  });
  if (!qrAttendanceOpen) await applyEventQrControls(event.id, isOpen, false);
  const fullEvent = await prisma.event.findUnique({ where: { id: event.id }, include: eventInclude });
  await writeAuditLog({ actorId: access.user.id, action: "event.create", targetType: "Event", targetId: event.id });
  if (event.published) {
    await createImmediateNotification({
      title: `New event: ${event.title}`,
      titleAr: `فعالية جديدة: ${event.titleAr || event.title}`,
      message: event.description,
      messageAr: event.descriptionAr || event.description,
      link: `/events?event=${encodeURIComponent(event.id)}`,
      type: "NEW_EVENT",
      audience: event.committeeId ? "COMMITTEE" : "EVERYONE",
      committeeId: event.committeeId,
      createdById: access.user.id,
    });
  }
  return NextResponse.json({ event: fullEvent }, { status: 201 });
}

export const GET = withApiErrorHandling(GETInternal, "/api/events");
export const POST = withApiErrorHandling(POSTInternal, "/api/events");
