import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { AttendanceAttemptStatus, AttendanceStatus } from "@/lib/db-enums";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { checkInSchema } from "@/lib/schemas";
import { hashIdentifier, requestIp } from "@/lib/security";
import { haversineMeters, isInsideZone, isLate } from "@/lib/attendance";
import { verifyQrToken } from "@/lib/qr-token";

const recentTimestampWindowMs = 2 * 60 * 1000;
const suspiciousAccuracyMeters = 75;

async function POSTInternal(request: Request) {
  const access = await requirePermission("attendance.scan.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the QR code and location details, then try again." }, { status: 400 });
  const input = parsed.data;
  const user = access.user;

  const now = new Date();
  const token = verifyQrToken(input.token, now.getTime());
  const sessionId = token?.sessionId;
  const session = sessionId
    ? await prisma.attendanceSession.findUnique({ where: { id: sessionId }, include: { zone: true, event: { select: { id: true, isOpen: true, qrAttendanceOpen: true } } } })
    : null;
  const ipHash = hashIdentifier(requestIp(request));
  const deviceHash = hashIdentifier(input.deviceId);
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  async function reject(reason: string, status = 400, distanceMeters?: number, suspicious = false) {
    if (sessionId && session) {
      await prisma.attendanceAttempt.create({
        data: {
          userId: user.id,
          sessionId,
          status: suspicious ? AttendanceAttemptStatus.SUSPICIOUS : AttendanceAttemptStatus.REJECTED,
          reason,
          distanceMeters,
          accuracyMeters: input.accuracy,
          deviceHash,
          ipHash,
          userAgent,
        },
      });
    }
    return NextResponse.json({ error: reason, distanceMeters }, { status });
  }

  if (!token || !session) return reject("This attendance QR code is invalid or has expired.");
  const tokenRecord = await prisma.qrToken.findUnique({ where: { jti: token.jti } });
  if (
    !tokenRecord || tokenRecord.sessionId !== session.id ||
    tokenRecord.expiresAt <= now || tokenRecord.static !== token.static ||
    (session.qrMode === "STATIC") !== token.static
  ) return reject("This attendance QR code is invalid or has expired.");
  if (session.event) {
    if (!session.event.isOpen) return reject("This event is closed for attendance.", 403);
    if (!session.event.qrAttendanceOpen) return reject("QR attendance scanning is currently closed for this event.", 403);
  }
  if (session.qrEnabled === false) return reject("QR attendance scanning is currently closed for this session.", 403);
  if (session.startsAt > now || session.endsAt <= now) return reject("This attendance session is not open.");
  if (session.committeeId && user.committeeId !== session.committeeId) {
    return reject("You are not eligible to check in to this session.", 403);
  }
  if (Math.abs(now.getTime() - input.timestamp) > recentTimestampWindowMs) {
    return reject("Your location reading is too old. Please scan again.", 400, undefined, true);
  }
  if (input.accuracy > suspiciousAccuracyMeters) {
    return reject("Your location accuracy is too low. Enable precise location and try again.", 400, undefined, true);
  }
  const zoneCenter = session.zone
    ? { latitude: session.zone.latitude, longitude: session.zone.longitude }
    : session.centerLat != null && session.centerLng != null
      ? { latitude: session.centerLat, longitude: session.centerLng }
      : null;
  const zoneRadius = session.zone?.radiusMeters ?? session.radiusMeters ?? null;
  if (!zoneCenter || zoneRadius == null) {
    return reject("This session has no attendance zone configured.", 403);
  }
  const distanceMeters = haversineMeters(
    { latitude: input.latitude, longitude: input.longitude },
    zoneCenter,
  );
  if (!isInsideZone(distanceMeters, input.accuracy, zoneRadius)) {
    const outsideMeters = Math.max(0, Math.round(distanceMeters + input.accuracy - zoneRadius));
    return reject(`You are ${outsideMeters} m away from the allowed area.`, 403, distanceMeters);
  }

  const priorDeviceAttempts = await prisma.attendanceAttempt.count({
    where: { sessionId: session.id, deviceHash, createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) } },
  });
  if (priorDeviceAttempts >= 4) return reject("This device has made too many attempts. Ask an administrator for help.", 429, distanceMeters, true);

  const status = isLate(now, session.startsAt, session.lateAfterMinutes)
    ? AttendanceStatus.LATE
    : AttendanceStatus.PRESENT;
  try {
    const record = await prisma.$transaction(async (transaction) => {
      const attendance = await transaction.attendanceRecord.create({
        data: {
          userId: user.id,
          sessionId: session.id,
          status,
          checkedInAt: now,
          distanceMeters,
          accuracyMeters: input.accuracy,
        },
        select: { id: true, status: true, checkedInAt: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "attendance.checkin.success",
          targetType: "AttendanceRecord",
          targetId: attendance.id,
          details: { sessionId: session.id, distanceMeters, accuracyMeters: input.accuracy, deviceHash },
          ipHash,
        },
      });
      return attendance;
    });
    return NextResponse.json({ record });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return reject("You have already checked in to this session.", 409, distanceMeters);
    }
    throw error;
  }
}

export const POST = withApiErrorHandling(POSTInternal, "/api/attendance/check-in");
