import { AttendanceTools, type AttendanceSessionView } from "@/components/attendance-tools";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { listClubCommittees } from "@/lib/committees";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "الحضور" : "Attendance", robots: { index: false, follow: false } };
}

export default async function AttendancePage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.pages.attendance" });
  const user = await requireUser();
  const now = new Date();
  if (user.role === "MEMBER") {
    const [sessions, records, attended] = await Promise.all([
      prisma.attendanceSession.count({ where: { endsAt: { lte: now }, OR: [{ committeeId: null }, { committeeId: user.committeeId }] } }),
      prisma.attendanceRecord.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { session: { select: { title: true } } },
      }),
      prisma.attendanceRecord.count({ where: { userId: user.id, status: { in: ["PRESENT", "LATE"] } } }),
    ]);
    return (
      <main id="main-content" className="inner-page">
        <section className="content-section page-intro">
          <div className="section-heading"><p className="eyebrow">{t("memberEyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("memberLead")}</p></div>
          <AttendanceTools role="MEMBER" initialSessions={[]} committees={[]} members={[]} records={records.map((record) => ({ ...record, checkedInAt: record.checkedInAt?.toISOString() ?? null }))} attendanceRate={sessions ? Math.round(attended / sessions * 100) : 0} />
        </section>
      </main>
    );
  }
  const sessions = await prisma.attendanceSession.findMany({
    where: {
      AND: [
        user.role === "ADMIN" ? {} : { OR: [{ committeeId: null }, { committeeId: user.committeeId }] },
        { OR: [{ eventId: null }, { event: { archivedAt: null } }] },
      ],
    },
    include: {
      committee: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
      _count: { select: { records: true } },
    },
    orderBy: { startsAt: "desc" },
  });
  const isAdmin = user.role === "ADMIN";
  const [committees, members, ownRecords, ownEligibleSessions, ownAttended] = await Promise.all([
    listClubCommittees(isAdmin ? undefined : user.committeeId),
    isAdmin ? prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, committeeId: true, committee: { select: { name: true } } } }) : Promise.resolve([]),
    isAdmin ? prisma.attendanceRecord.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50, include: { session: { select: { title: true } } } }) : Promise.resolve([]),
    isAdmin ? prisma.attendanceSession.count({ where: { endsAt: { lte: now }, OR: [{ committeeId: null }, { committeeId: user.committeeId }] } }) : Promise.resolve(0),
    isAdmin ? prisma.attendanceRecord.count({ where: { userId: user.id, status: { in: ["PRESENT", "LATE"] } } }) : Promise.resolve(0),
  ]);
  const sessionViews: AttendanceSessionView[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    lateAfterMinutes: session.lateAfterMinutes,
    qrMode: session.qrMode,
    committee: session.committee,
    zone: session.zone,
    centerLat: session.centerLat,
    centerLng: session.centerLng,
    radiusMeters: session.radiusMeters,
    locationAccuracy: session.locationAccuracy,
    placeName: session.placeName,
    recordCount: session._count.records,
  }));
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{user.role === "ADMIN" ? "ADMIN" : "LEADER"} · {t("eyebrow")}</p><h1>{t("sessionsTitle")}</h1><p className="section-lead">{t("lead")}</p></div>
        <AttendanceTools
          role={user.role}
          initialSessions={sessionViews}
          committees={committees}
          members={members}
          records={ownRecords.map((record) => ({ ...record, checkedInAt: record.checkedInAt?.toISOString() ?? null }))}
          attendanceRate={ownEligibleSessions ? Math.round(ownAttended / ownEligibleSessions * 100) : 0}
          userRole={user.role}
          userCommitteeId={user.committeeId}
        />
      </section>
    </main>
  );
}
