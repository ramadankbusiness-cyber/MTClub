import { redirect } from "next/navigation";
import { AdminEventManager, type ManagedEvent } from "@/components/admin-event-manager";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { listClubCommittees } from "@/lib/committees";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "إدارة الفعاليات" : "Manage events", robots: { index: false, follow: false } };
}

export default async function AdminEventsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminCommunication.events" });
  const access = await requirePermission("events.create");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const isAdmin = access.user.role === "ADMIN";
  const eventWhere = isAdmin ? {} : { committeeId: access.user.committeeId };
  const eventInclude = {
    committee: { select: { id: true, name: true } },
    attendanceSessions: {
      include: {
        committee: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
        event: { select: { id: true, isOpen: true, qrAttendanceOpen: true, archivedAt: true } },
        _count: { select: { records: true } },
      },
      orderBy: { startsAt: "asc" as const },
    },
  };
  type EventRow = {
    archivedAt: Date | null;
    centerLat: number | null;
    centerLng: number | null;
    radiusMeters: number | null;
    isOpen: boolean;
    qrAttendanceOpen: boolean;
    attendanceSessions?: Array<{ startsAt: Date; endsAt: Date; _count: { records: number } }>;
    [key: string]: unknown;
  };
  const mapEvent = (event: EventRow) => ({
    ...event,
    archivedAt: event.archivedAt ? new Date(event.archivedAt).toISOString() : null,
    centerLat: event.centerLat ?? 30.0444,
    centerLng: event.centerLng ?? 31.2357,
    radiusMeters: event.radiusMeters ?? 100,
    isOpen: event.isOpen ?? true,
    qrAttendanceOpen: event.qrAttendanceOpen ?? false,
    attendanceSessions: (event.attendanceSessions ?? []).map((session) => ({
      ...session,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      recordCount: session._count.records,
    })),
  }) as unknown as ManagedEvent;
  const [events, archivedEvents, committees] = await Promise.all([
    prisma.event.findMany({ where: { ...eventWhere, archivedAt: null }, include: eventInclude, orderBy: { startsAt: "desc" } }).then((rows) => rows.map(mapEvent)),
    isAdmin ? prisma.event.findMany({ where: { archivedAt: { not: null } }, include: eventInclude, orderBy: { archivedAt: "desc" } }).then((rows) => rows.map(mapEvent)) : Promise.resolve([]),
    listClubCommittees(isAdmin ? undefined : access.user.committeeId),
  ]);
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <AdminEventManager initialEvents={events} initialArchivedEvents={archivedEvents} committees={committees} isAdmin={isAdmin} userRole={access.user.role} userCommitteeId={access.user.committeeId} />
      </section>
    </main>
  );
}
