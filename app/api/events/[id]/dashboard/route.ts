import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canAccessCommittee } from "@/lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

type RegRow = {
  id: string;
  name: string;
  email: string | null;
  type: "MEMBER" | "EXTERNAL";
  submittedAt: Date;
  formId: string;
  submissionPublicId: string;
};

async function GETInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("events.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, title: true, titleAr: true, startsAt: true, committeeId: true, published: true, archivedAt: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const isAdmin = access.user.role === "ADMIN";
  const isLeader = access.user.role === "LEADER";
  if (!isAdmin && !(isLeader && canAccessCommittee(access.user, event.committeeId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [readinessRows, regLinks, attendanceSessions] = await Promise.all([
    prisma.eventReadiness.findMany({
      where: { eventId: id },
      include: { user: { select: { id: true, name: true, email: true, committeeId: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.formEvent.findMany({ where: { eventId: id, kind: "REGISTRATION" }, select: { formId: true } }),
    prisma.attendanceSession.findMany({ where: { eventId: id }, select: { id: true } }),
  ]);

  const registrationFormIds = regLinks.map((l) => l.formId);
  const regSubmissions = registrationFormIds.length ? await prisma.formSubmission.findMany({
    where: { formId: { in: registrationFormIds } },
    select: {
      id: true,
      publicId: true,
      formId: true,
      respondentUserId: true,
      respondentEmail: true,
      respondentName: true,
      submittedAt: true,
      respondentUser: { select: { id: true, name: true, email: true, committeeId: true } },
    },
    orderBy: { submittedAt: "asc" },
  }) : [];

  const sessionIds = attendanceSessions.map((s) => s.id);
  const attendanceRecords = sessionIds.length ? await prisma.attendanceRecord.findMany({
    where: { sessionId: { in: sessionIds }, status: { in: ["PRESENT", "LATE"] } },
    select: {
      userId: true,
      status: true,
      source: true,
      checkedInAt: true,
      user: { select: { id: true, name: true, email: true, committeeId: true } },
    },
  }) : [];

  // Interested (deduped by userId, unique constraint already)
  const interested = readinessRows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    readinessAt: r.createdAt,
  }));
  const interestedUserIds = new Set(interested.map((r) => r.id));

  // Registrations - include all submissions (member + external/public), avoid double-counting by submission id.
  const registrations: RegRow[] = regSubmissions.map((s) => {
    const isMember = !!s.respondentUserId && !!s.respondentUser;
    return {
      id: isMember ? s.respondentUser!.id : `external:${s.publicId}`,
      name: isMember ? s.respondentUser!.name : (s.respondentName?.trim() || s.respondentEmail?.trim() || "External registrant"),
      email: isMember ? s.respondentUser!.email : (s.respondentEmail?.trim() || null),
      type: isMember ? "MEMBER" : "EXTERNAL",
      submittedAt: s.submittedAt,
      formId: s.formId,
      submissionPublicId: s.publicId,
    };
  });

  const totalRegistrations = registrations.length;
  const memberRegistrationRows = registrations.filter((r) => r.type === "MEMBER");
  const externalRegistrationRows = registrations.filter((r) => r.type === "EXTERNAL");
  const memberRegistrations = memberRegistrationRows.length;
  const externalRegistrations = externalRegistrationRows.length;

  // Unique registered people: members deduped by user id; externals deduped only when stable identity exists (email), otherwise counted as submissions-not-unique.
  const uniqueMemberIds = new Set(memberRegistrationRows.map((r) => r.id));
  const externalWithEmail = externalRegistrationRows.filter((r) => r.email);
  const uniqueExternalEmails = new Set(externalWithEmail.map((r) => r.email!.toLowerCase()));
  const externalWithoutStableIdentity = externalRegistrationRows.length - externalWithEmail.length;
  const uniqueRegisteredPeople = uniqueMemberIds.size + uniqueExternalEmails.size; // excludes external rows without stable identity
  const uniqueRegisteredPeopleIsPartial = externalWithoutStableIdentity > 0;

  // Attendance: dedupe by user, classify by source. QR-verified takes precedence as "QR verified" label for a person, but we report source.
  type Att = { id: string; name: string; email: string; checkedInAt: Date | null; status: string; source: "QR" | "MANUAL" | "EXCUSE" | "UNKNOWN" };
  const byUser = new Map<string, Att[]>();
  for (const a of attendanceRecords) {
    const list = byUser.get(a.userId) ?? [];
    list.push({ id: a.user.id, name: a.user.name, email: a.user.email, checkedInAt: a.checkedInAt, status: a.status, source: (a.source as Att["source"]) ?? "UNKNOWN" });
    byUser.set(a.userId, list);
  }
  const attendedRows: Att[] = [];
  for (const [, rows] of byUser) {
    // prefer QR, then MANUAL, then UNKNOWN, then EXCUSE; pick latest checkedInAt among chosen source
    const priority: Att["source"][] = ["QR", "MANUAL", "UNKNOWN", "EXCUSE"];
    let chosen: Att | undefined;
    for (const p of priority) {
      const candidates = rows.filter((r) => r.source === p);
      if (candidates.length) {
        chosen = candidates.sort((a, b) => (b.checkedInAt?.getTime() ?? 0) - (a.checkedInAt?.getTime() ?? 0))[0];
        break;
      }
    }
    if (chosen) attendedRows.push(chosen);
  }

  const qrVerifiedAttended = attendedRows.filter((r) => r.source === "QR").length;
  const manualAttended = attendedRows.filter((r) => r.source === "MANUAL").length;
  const unknownOriginAttended = attendedRows.filter((r) => r.source === "UNKNOWN").length;
  const attendedTotalUnique = attendedRows.length;

  // Rates - explicitly documented and population-consistent.
  // Attendance % uses QR-verified attended members who are within the unique registered-member population,
  // divided by unique registered members. This prevents >100% when non-registered members attend by QR.
  const attendanceDenominator = uniqueMemberIds.size;
  const qrVerifiedRegisteredMembers = attendedRows.filter((r) => r.source === "QR" && uniqueMemberIds.has(r.id)).length;
  const attendancePercentage = attendanceDenominator > 0
    ? Math.min(100, Math.round((qrVerifiedRegisteredMembers / attendanceDenominator) * 10000) / 100)
    : 0;
  const conversionDenominator = interested.length;
  const interestedRegisteredMembers = Array.from(uniqueMemberIds).filter((uid) => interestedUserIds.has(uid)).length;
  const conversionInterestedToRegistered = conversionDenominator > 0 ? Math.round((interestedRegisteredMembers / conversionDenominator) * 10000) / 100 : 0;

  return NextResponse.json({
    event: { id: event.id, title: event.title, titleAr: event.titleAr, startsAt: event.startsAt },
    counts: {
      interested: interested.length,
      totalRegistrations,
      memberRegistrations,
      externalRegistrations,
      uniqueRegisteredPeople,
      uniqueRegisteredPeopleIsPartial,
      externalWithoutStableIdentity,
      qrVerifiedAttended,
      manualAttended,
      unknownOriginAttended,
      attendedTotalUnique,
      interestedAndRegisteredMembers: interestedRegisteredMembers,
    },
    rates: {
      attendancePercentage,
      attendanceNumerator: "qrVerifiedRegisteredMembers",
      attendanceNumeratorValue: qrVerifiedRegisteredMembers,
      attendanceDenominator: "uniqueMemberRegistrations",
      attendanceDenominatorValue: attendanceDenominator,
      conversionInterestedToRegistered,
      conversionNumerator: "interestedAndRegisteredMembers",
      conversionDenominator: "interested",
      conversionDenominatorValue: conversionDenominator,
    },
    lists: {
      interested,
      registrations: registrations.map((r) => ({ ...r, submittedAt: r.submittedAt })),
      attended: attendedRows.map((r) => ({ ...r, checkedInAt: r.checkedInAt })),
    },
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/events/[id]/dashboard");
