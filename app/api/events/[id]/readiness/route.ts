import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { writeAuditLog } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

async function getEventForReadiness(id: string) {
  return prisma.event.findUnique({
    where: { id },
    select: { id: true, published: true, archivedAt: true, committeeId: true, startsAt: true, title: true },
  });
}

async function GETInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("events.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const user = access.user;
  const { id } = await context.params;
  const event = await getEventForReadiness(id);
  if (!event || !event.published || event.archivedAt) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const readiness = await prisma.eventReadiness.findUnique({
    where: { eventId_userId: { eventId: id, userId: user.id } },
    select: { id: true, createdAt: true },
  });
  return NextResponse.json({ interested: !!readiness, readinessAt: readiness?.createdAt ?? null });
}

async function POSTInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("events.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const user = access.user;
  const { id } = await context.params;
  const event = await getEventForReadiness(id);
  if (!event || !event.published || event.archivedAt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const action = body?.action === "withdraw" ? "withdraw" : body?.action === "interested" ? "interested" : null;
  if (!action) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  if (action === "interested") {
    const existing = await prisma.eventReadiness.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } }, select: { id: true } });
    if (!existing) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.eventReadiness.create({ data: { eventId: id, userId: user.id } });
          await writeAuditLog({ actorId: user.id, action: "event.readiness.interested", targetType: "Event", targetId: id, details: { eventId: id } }, tx);
        });
      } catch (err: unknown) {
        const code = (err && typeof err === "object" && "code" in err) ? String((err as { code?: unknown }).code) : "";
        const meta = (err && typeof err === "object" && "meta" in err) ? (err as { meta?: { target?: unknown } }).meta : undefined;
        const target = meta?.target;
        const targetText = Array.isArray(target) ? target.join(",") : String(target ?? "");
        const isExpectedUnique = code === "P2002" && (targetText.includes("eventId_userId") || targetText.includes("EventReadiness_eventId_userId"));
        if (!isExpectedUnique) throw err;
        // Concurrent duplicate create: idempotent success, no duplicate audit log.
      }
    }
    return NextResponse.json({ ok: true, interested: true });
  }

  const deleted = await prisma.eventReadiness.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } }, select: { id: true } });
  if (deleted) {
    await prisma.$transaction(async (tx) => {
      await tx.eventReadiness.deleteMany({ where: { eventId: id, userId: user.id } });
      await writeAuditLog({ actorId: user.id, action: "event.readiness.withdrawn", targetType: "Event", targetId: id, details: { eventId: id } }, tx);
    });
  } else {
    await prisma.eventReadiness.deleteMany({ where: { eventId: id, userId: user.id } });
  }
  return NextResponse.json({ ok: true, interested: false });
}

export const GET = withApiErrorHandling(GETInternal, "/api/events/[id]/readiness");
export const POST = withApiErrorHandling(POSTInternal, "/api/events/[id]/readiness");
