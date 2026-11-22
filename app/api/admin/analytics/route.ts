import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";

async function GETInternal(request: Request) {
  const access = await requirePermission("points.view");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const committeeId = url.searchParams.get("committeeId") || undefined;
  const now = new Date();

  const memberWhere: Record<string, unknown> = { isActive: true, role: { in: ["MEMBER", "LEADER", "ADMIN"] } };
  if (committeeId) memberWhere.committeeId = committeeId;
  const members = await prisma.user.findMany({
    where: memberWhere,
    select: { id: true, name: true, committeeId: true, createdAt: true, committee: { select: { name: true, nameAr: true } } },
  });
  const memberIds = members.map((m) => m.id);

  const completedSessions = await prisma.attendanceSession.findMany({
    where: { endsAt: { lte: now } },
    select: { id: true, committeeId: true, eventId: true, startsAt: true },
  });

  const [records, pointAgg, manualAdd, manualDeduct] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId: { in: memberIds }, session: { endsAt: { lte: now } } },
      select: { userId: true, sessionId: true, status: true, checkedInAt: true },
    }),
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: memberIds } }, _sum: { amount: true } }),
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: memberIds }, type: "MANUAL_ADD" }, _sum: { amount: true } }),
    prisma.pointTransaction.groupBy({ by: ["userId"], where: { userId: { in: memberIds }, type: "MANUAL_DEDUCT" }, _sum: { amount: true } }),
  ]);

  const pointsMap = new Map(pointAgg.map((p) => [p.userId, p._sum.amount ?? 0]));
  const manualAddMap = new Map(manualAdd.map((p) => [p.userId, p._sum.amount ?? 0]));
  const manualDeductMap = new Map(manualDeduct.map((p) => [p.userId, Math.abs(p._sum.amount ?? 0)]));
  const recordsByUser = new Map<string, typeof records>();
  for (const r of records) {
    const arr = recordsByUser.get(r.userId) ?? [];
    arr.push(r);
    recordsByUser.set(r.userId, arr);
  }

  const perMember = members.map((m) => {
    const eligibleSessions = completedSessions.filter((s) => !s.committeeId || s.committeeId === m.committeeId);
    const eligibleIds = new Set(eligibleSessions.map((s) => s.id));
    const userRecords = (recordsByUser.get(m.id) ?? []).filter((r) => eligibleIds.has(r.sessionId));
    let present = 0, late = 0, absent = 0, excused = 0;
    let lastAttendance: string | null = null;
    for (const r of userRecords) {
      if (r.status === "PRESENT") present++;
      else if (r.status === "LATE") late++;
      else if (r.status === "ABSENT") absent++;
      else if (r.status === "EXCUSED") excused++;
      if ((r.status === "PRESENT" || r.status === "LATE") && r.checkedInAt) {
        const iso = r.checkedInAt.toISOString();
        if (!lastAttendance || iso > lastAttendance) lastAttendance = iso;
      }
    }
    const attended = present + late;
    const totalEligible = eligibleSessions.length;
    const attendancePercentage = totalEligible ? Math.round((attended / totalEligible) * 100) : 0;
    return {
      id: m.id, name: m.name, committee: m.committee,
      totalEligible, present, late, absent, excused, attended, attendancePercentage,
      currentPoints: pointsMap.get(m.id) ?? 0,
      manualAdded: manualAddMap.get(m.id) ?? 0,
      manualDeducted: manualDeductMap.get(m.id) ?? 0,
      lastAttendanceDate: lastAttendance,
    };
  });

  const byAttendance = [...perMember].sort((a, b) => b.attendancePercentage - a.attendancePercentage || b.attended - a.attended);
  const byPoints = [...perMember].sort((a, b) => b.currentPoints - a.currentPoints);
  const frequentAbsence = [...perMember].filter((m) => m.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 10);
  const frequentLate = [...perMember].filter((m) => m.late > 0).sort((a, b) => b.late - a.late).slice(0, 10);

  return NextResponse.json({
    summary: {
      totalMembers: perMember.length,
      avgAttendance: perMember.length ? Math.round(perMember.reduce((s, m) => s + m.attendancePercentage, 0) / perMember.length) : 0,
      avgPoints: perMember.length ? Math.round(perMember.reduce((s, m) => s + m.currentPoints, 0) / perMember.length) : 0,
    },
    topAttendance: byAttendance.slice(0, 10),
    lowestAttendance: [...byAttendance].reverse().slice(0, 10),
    topPoints: byPoints.slice(0, 10),
    frequentAbsence,
    frequentLate,
    members: perMember,
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/analytics");
