import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { excuseSchema } from "@/lib/schemas";
import { writeAuditLog } from "@/lib/audit";

async function GETInternal() {
  const adminAccess = await requirePermission("excuses.read.all");
  if ("error" in adminAccess) {
    const leaderAccess = await requirePermission("excuses.read.committee");
    if ("error" in leaderAccess) {
      const memberAccess = await requirePermission("excuses.create.own");
      if ("error" in memberAccess) return NextResponse.json({ error: memberAccess.error }, { status: memberAccess.status });
      const excuses = await prisma.excuse.findMany({
        where: { userId: memberAccess.user.id },
        include: { session: { select: { id: true, title: true, startsAt: true } }, reviewer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ excuses });
    }
    const excuses = await prisma.excuse.findMany({
      where: { user: { committeeId: leaderAccess.user.committeeId } },
      include: { user: { select: { id: true, name: true, committeeId: true } }, session: { select: { id: true, title: true, startsAt: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ excuses });
  }
  const excuses = await prisma.excuse.findMany({
    include: { user: { select: { id: true, name: true, committeeId: true, committee: { select: { name: true } } } }, session: { select: { id: true, title: true, startsAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ excuses });
}

async function POSTInternal(request: Request) {
  const access = await requirePermission("excuses.create.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = excuseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a session and explain your request." }, { status: 400 });
  const session = await prisma.attendanceSession.findUnique({ where: { id: parsed.data.sessionId }, select: { id: true, committeeId: true, event: { select: { archivedAt: true } } } });
  if (!session) return NextResponse.json({ error: "Attendance session not found." }, { status: 404 });
  if (session.event?.archivedAt) return NextResponse.json({ error: "Archived events cannot receive new excuse requests." }, { status: 409 });
  if (session.committeeId && session.committeeId !== access.user.committeeId) {
    return NextResponse.json({ error: "You cannot request an excuse for that session." }, { status: 403 });
  }
  try {
    const excuse = await prisma.excuse.create({
      data: { userId: access.user.id, sessionId: session.id, reason: parsed.data.reason },
      include: { session: { select: { title: true, startsAt: true } } },
    });
    await writeAuditLog({ actorId: access.user.id, action: "excuse.create", targetType: "Excuse", targetId: excuse.id });
    return NextResponse.json({ excuse }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "You already have an excuse request for this session." }, { status: 409 });
    }
    throw error;
  }
}

export const GET = withApiErrorHandling(GETInternal, "/api/excuses");
export const POST = withApiErrorHandling(POSTInternal, "/api/excuses");
