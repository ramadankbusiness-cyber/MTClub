import { prisma } from "@/lib/prisma";

type EventLike = {
  id: string;
  title: string;
  titleAr: string | null;
  startsAt: Date;
  endsAt: Date | null;
  committeeId: string | null;
  placeName: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
  locationAccuracy: number | null;
  zoneId: string | null;
  createdById: string;
  isOpen: boolean;
  qrAttendanceOpen: boolean;
};

function utcDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export function buildEventSessionWindows(event: Pick<EventLike, "startsAt" | "endsAt">) {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (!end || utcDayKey(start) === utcDayKey(end)) {
    return [{ startsAt: start, endsAt: end ?? new Date(start.getTime() + 2 * 60 * 60 * 1000), dayKey: utcDayKey(start) }];
  }
  const days: { startsAt: Date; endsAt: Date; dayKey: string }[] = [];
  let cursor = startOfUtcDay(start);
  const lastDay = startOfUtcDay(end);
  const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();
  const fallbackEndMinutes = Math.max(startMinutes + 60, 23 * 60 + 59);
  while (cursor <= lastDay) {
    const dayKey = utcDayKey(cursor);
    const dayStart = new Date(cursor.getTime() + startMinutes * 60 * 1000);
    let dayEndMinutes = endMinutes;
    if (utcDayKey(cursor) === utcDayKey(lastDay)) {
      if (endMinutes <= startMinutes && utcDayKey(start) !== utcDayKey(end)) dayEndMinutes = fallbackEndMinutes;
    } else {
      // For intermediate days of a multi-day event, keep the same end time-of-day if later than start; otherwise use end-of-day.
      dayEndMinutes = endMinutes > startMinutes ? endMinutes : fallbackEndMinutes;
    }
    let dayEnd = new Date(cursor.getTime() + dayEndMinutes * 60 * 1000);
    if (dayEnd <= dayStart) dayEnd = new Date(dayStart.getTime() + 60 * 60 * 1000);
    days.push({ startsAt: dayStart, endsAt: dayEnd, dayKey });
    cursor = addUtcDays(cursor, 1);
  }
  return days;
}

export async function syncEventAttendanceSessions(event: EventLike & { archivedAt?: Date | null }) {
  if (event.archivedAt) {
    return prisma.attendanceSession.findMany({
      where: { eventId: event.id },
      include: { committee: { select: { id: true, name: true } }, zone: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } }, event: { select: { id: true, isOpen: true, qrAttendanceOpen: true, archivedAt: true } }, _count: { select: { records: true } } },
      orderBy: { startsAt: "asc" },
    });
  }
  const windows = buildEventSessionWindows(event);
  const existing = await prisma.attendanceSession.findMany({
    where: { eventId: event.id },
    orderBy: { startsAt: "asc" },
  });
  const byDay = new Map<string, typeof existing>();
  for (const session of existing) {
    const key = utcDayKey(new Date(session.startsAt));
    const list = byDay.get(key) ?? [];
    list.push(session);
    byDay.set(key, list);
  }

  const keptIds = new Set<string>();
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    const title = windows.length === 1 ? event.title : `${event.title} — Day ${index + 1}`;
    const candidates = (byDay.get(window.dayKey) ?? []).filter((session) => !keptIds.has(session.id));
    const target = candidates[0];
    const data = {
      title,
      eventId: event.id,
      committeeId: event.committeeId,
      zoneId: event.zoneId,
      placeName: event.placeName,
      centerLat: event.centerLat,
      centerLng: event.centerLng,
      radiusMeters: event.radiusMeters,
      locationAccuracy: event.locationAccuracy,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      qrEnabled: event.isOpen && event.qrAttendanceOpen,
      createdById: event.createdById,
    };
    if (target) {
      await prisma.attendanceSession.update({
        where: { id: target.id },
        data,
      });
      keptIds.add(target.id);
    } else {
      const created = await prisma.attendanceSession.create({ data });
      keptIds.add(created.id);
    }
  }

  // Remove only extra sessions that have no attendance history to preserve existing records.
  const removable = existing.filter((session) => !keptIds.has(session.id));
  for (const session of removable) {
    const [recordCount, attemptCount, excuseCount] = await Promise.all([
      prisma.attendanceRecord.count({ where: { sessionId: session.id } }),
      prisma.attendanceAttempt.count({ where: { sessionId: session.id } }),
      prisma.excuse.count({ where: { sessionId: session.id } }),
    ]);
    if (recordCount === 0 && attemptCount === 0 && excuseCount === 0) {
      await prisma.qrToken.deleteMany({ where: { sessionId: session.id } });
      await prisma.attendanceSession.delete({ where: { id: session.id } });
    }
  }

  return prisma.attendanceSession.findMany({
    where: { eventId: event.id },
    include: {
      committee: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
      event: { select: { id: true, isOpen: true, qrAttendanceOpen: true } },
      _count: { select: { records: true } },
    },
    orderBy: { startsAt: "asc" },
  });
}

export async function applyEventQrControls(eventId: string, isOpen: boolean, qrAttendanceOpen: boolean) {
  const safeQrOpen = isOpen && qrAttendanceOpen;
  const event = await prisma.event.update({
    where: { id: eventId },
    data: { isOpen, qrAttendanceOpen: safeQrOpen },
  });
  await prisma.attendanceSession.updateMany({
    where: { eventId },
    data: { qrEnabled: safeQrOpen },
  });
  if (!safeQrOpen) {
    const now = new Date();
    const sessions = await prisma.attendanceSession.findMany({ where: { eventId }, select: { id: true } });
    if (sessions.length) {
      await prisma.qrToken.updateMany({
        where: { sessionId: { in: sessions.map((s) => s.id) }, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
    }
  }
  return event;
}
