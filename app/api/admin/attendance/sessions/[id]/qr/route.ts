import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { issueQrToken, rotatingTokenExpiry } from "@/lib/qr-token";
import { writeAuditLog } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

async function POSTInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("attendance.qr.generate");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "issue";
  const session = await prisma.attendanceSession.findUnique({ where: { id }, include: { event: { select: { id: true, isOpen: true, qrAttendanceOpen: true } } } });
  const now = new Date();
  if (!session) return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });

  if (action === "invalidate") {
    await prisma.qrToken.updateMany({
      where: { sessionId: id, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    await writeAuditLog({
      actorId: access.user.id,
      action: "attendance.qr.invalidate",
      targetType: "AttendanceSession",
      targetId: id,
    });
    return NextResponse.json({ ok: true, invalidated: true });
  }

  if (session.event) {
    if (!session.event.isOpen) return NextResponse.json({ error: "Event is closed. Open the event before enabling QR attendance." }, { status: 409 });
    if (!session.event.qrAttendanceOpen) return NextResponse.json({ error: "QR attendance is closed for this event." }, { status: 409 });
  }
  if (session.qrEnabled === false) return NextResponse.json({ error: "QR scanning is disabled for this session." }, { status: 409 });
  if (session.startsAt > now || session.endsAt <= now) {
    return NextResponse.json({ error: "QR codes are available only while the attendance session is open." }, { status: 409 });
  }

  if (action === "regenerate") {
    await prisma.qrToken.updateMany({
      where: { sessionId: id, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  }

  const isStatic = session.qrMode === "STATIC";
  const expiry = isStatic ? session.endsAt : rotatingTokenExpiry(now.getTime());
  const previous = (isStatic && action !== "regenerate")
    ? await prisma.qrToken.findFirst({ where: { sessionId: id, static: true, expiresAt: { gt: now } }, orderBy: { createdAt: "asc" } })
    : null;
  const issued = issueQrToken({ sessionId: id, static: isStatic, expiresAt: expiry, jti: previous?.jti });
  if (!previous) {
    await prisma.qrToken.create({ data: { jti: issued.jti, sessionId: id, expiresAt: expiry, static: isStatic } });
  }
  await writeAuditLog({
    actorId: access.user.id,
    action: action === "regenerate" ? "attendance.qr.regenerate" : (isStatic ? "attendance.qr.static.issue" : "attendance.qr.rotating.issue"),
    targetType: "AttendanceSession",
    targetId: id,
  });
  return NextResponse.json({ token: issued.token, expiresAt: expiry.toISOString(), static: isStatic, regenerated: action === "regenerate" });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/admin/attendance/sessions/[id]/qr");
