import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { excuseReviewSchema } from "@/lib/schemas";
import { createImmediateNotification } from "@/lib/notification-delivery";
import { writeAuditLog } from "@/lib/audit";
import { syncAttendancePoints, sendPointNotifications } from "@/lib/points";

type RouteContext = { params: Promise<{ id: string }> };

async function PATCHInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("excuses.review");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = excuseReviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  const { id } = await context.params;
  const existing = await prisma.excuse.findUnique({
    where: { id },
    include: { user: { select: { id: true, committeeId: true } }, session: { select: { id: true, committeeId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Excuse request not found." }, { status: 404 });
  if (access.user.role === "LEADER" && existing.user.committeeId !== access.user.committeeId) {
    return NextResponse.json({ error: "You can only review requests from your committee." }, { status: 403 });
  }
  if (existing.status !== "PENDING") return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });
  const updated = await prisma.$transaction(async (transaction) => {
    const excuse = await transaction.excuse.update({
      where: { id },
      data: { status: parsed.data.status, reviewNote: parsed.data.reviewNote ?? null, reviewerId: access.user.id, reviewedAt: new Date() },
      include: { user: { select: { id: true, name: true } }, session: { select: { id: true, title: true } } },
    });
    let pointNotifications: Awaited<ReturnType<typeof syncAttendancePoints>> = [];
    if (parsed.data.status === "APPROVED") {
      const record = await transaction.attendanceRecord.upsert({
        where: { userId_sessionId: { userId: excuse.user.id, sessionId: excuse.session.id } },
        create: {
          userId: excuse.user.id, sessionId: excuse.session.id, status: "EXCUSED", source: "EXCUSE",
          reason: parsed.data.reviewNote ?? excuse.reason, markedById: access.user.id,
        },
        update: {
          status: "EXCUSED", source: "EXCUSE", reason: parsed.data.reviewNote ?? excuse.reason,
          markedById: access.user.id, checkedInAt: null, distanceMeters: null, accuracyMeters: null,
        },
      });
      pointNotifications = await syncAttendancePoints(transaction, {
        attendanceRecordId: record.id,
        userId: excuse.user.id,
        sessionId: excuse.session.id,
        newStatus: "EXCUSED",
        actorId: access.user.id,
      });
    }
    return { excuse, pointNotifications };
  });
  await writeAuditLog({ actorId: access.user.id, action: `excuse.${parsed.data.status.toLowerCase()}`, targetType: "Excuse", targetId: id });
  await createImmediateNotification({
    title: `Excuse request ${parsed.data.status.toLowerCase()}`,
    message: `Your request for ${updated.excuse.session.title} was ${parsed.data.status.toLowerCase()}.${parsed.data.reviewNote ? ` ${parsed.data.reviewNote}` : ""}`,
    link: "/attendance",
    type: "EXCUSE_DECISION",
    audience: "USERS",
    committeeId: null,
    createdById: access.user.id,
    userIds: [updated.excuse.user.id],
  });
  await sendPointNotifications(updated.pointNotifications);
  return NextResponse.json({ excuse: updated.excuse });
}

export const PATCH = withApiErrorHandling(PATCHInternal, "/api/excuses/[id]");
