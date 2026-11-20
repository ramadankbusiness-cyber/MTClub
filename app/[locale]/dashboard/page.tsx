import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { countUnreadForUser } from "@/lib/notification-delivery";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "لوحة التحكم" : "Dashboard", robots: { index: false, follow: false } };
}

function percentage(attended: number, eligible: number) {
  return eligible ? Math.round(attended / eligible * 100) : 0;
}

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.dashboard" });
  const user = await requireUser();
  const now = new Date();
  const upcomingEvents = await prisma.event.findMany({
    where: {
      published: true,
      startsAt: { gte: now },
      ...(user.role === "ADMIN" ? {} : { OR: [{ committeeId: null }, { committeeId: user.committeeId }] }),
    },
    orderBy: { startsAt: "asc" },
    take: 3,
    select: { id: true, title: true, titleAr: true, startsAt: true, location: true },
  });
  const unreadCount = await countUnreadForUser(user.id);

  let stats: { label: string; value: string }[] = [];
  let activity: { id: string; label: string; date: Date }[] = [];
  if (user.role === "ADMIN") {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [members, todaySessions, checkIns, logs] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.attendanceSession.count({ where: { startsAt: { gte: startOfDay }, endsAt: { gt: now } } }),
      prisma.attendanceRecord.count({ where: { checkedInAt: { gte: startOfDay } } }),
      prisma.auditLog.findMany({ take: 5, orderBy: { createdAt: "desc" }, select: { id: true, action: true, createdAt: true } }),
    ]);
    stats = [
      { label: t("activeAccounts"), value: String(members) },
      { label: t("sessionsToday"), value: String(todaySessions) },
      { label: t("checkInsToday"), value: String(checkIns) },
      { label: t("unreadNotifications"), value: String(unreadCount) },
    ];
    activity = logs.map((log) => ({ id: log.id, label: log.action.replaceAll(".", " "), date: log.createdAt }));
  } else if (user.role === "LEADER") {
    const [members, sessions, checkIns] = await Promise.all([
      prisma.user.count({ where: { committeeId: user.committeeId, role: "MEMBER", isActive: true } }),
      prisma.attendanceSession.count({ where: { committeeId: user.committeeId, endsAt: { gte: now } } }),
      prisma.attendanceRecord.count({ where: { session: { committeeId: user.committeeId }, checkedInAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } }),
    ]);
    stats = [
      { label: t("activeMembers"), value: String(members) },
      { label: t("upcomingSessions"), value: String(sessions) },
      { label: t("checkInsMonth"), value: String(checkIns) },
      { label: t("unreadNotifications"), value: String(unreadCount) },
    ];
  } else {
    const eligibleSessions = await prisma.attendanceSession.count({
      where: {
        endsAt: { lte: now },
        OR: [{ committeeId: null }, { committeeId: user.committeeId }],
      },
    });
    const attended = await prisma.attendanceRecord.count({
      where: { userId: user.id, status: { in: ["PRESENT", "LATE"] } },
    });
    const [lastRecords, latestNotice] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { userId: user.id },
        orderBy: { checkedInAt: "desc" },
        take: 3,
        include: { session: { select: { title: true } } },
      }),
      prisma.notificationRecipient.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { notification: { select: { title: true, titleAr: true, message: true, messageAr: true } } },
      }),
    ]);
    stats = [
      { label: t("attendance"), value: `${percentage(attended, eligibleSessions)}%` },
      { label: t("sessionsAttended"), value: String(attended) },
      { label: t("sessionsHeld"), value: String(eligibleSessions) },
      { label: t("unreadNotifications"), value: String(unreadCount) },
    ];
    activity = lastRecords.map((record) => ({ id: record.id, label: `${record.session.title} · ${t(`attendanceStatus.${record.status}`)}`, date: record.checkedInAt ?? record.createdAt }));
    if (latestNotice) activity.unshift({ id: latestNotice.id, label: locale === "ar" ? latestNotice.notification.titleAr || latestNotice.notification.title : latestNotice.notification.title, date: latestNotice.createdAt });
  }

  const links = user.role === "ADMIN"
    ? [
      { href: "/admin/users", label: t("manageAccounts") },
      { href: "/team", label: t("manageTeam") },
      { href: "/admin/events", label: t("manageEvents") },
      { href: "/admin/zones", label: t("zones") },
      { href: "/attendance", label: t("attendanceSessions") },
      { href: "/admin/notifications", label: t("sendNotifications") },
      { href: "/admin/audit", label: t("audit") },
      { href: "/admin/permissions", label: t("permissions") },
    ]
    : user.role === "LEADER" ? [
      { href: "/admin/events", label: t("manageCommitteeEvents") },
      { href: "/attendance", label: t("viewSessions") },
      { href: "/admin/notifications", label: t("notifyCommittee") },
    ] : [{ href: "/attendance", label: t("scanAttendance") }];
  const dashboardTitle = user.role === "ADMIN" ? t("admin") : user.role === "LEADER" ? t("leader") : t("member");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro dashboard-page">
        <div className="section-heading">
          <p className="eyebrow">{dashboardTitle}</p>
          <h1>{t("welcome")} <span className="gradient-text">{user.name.split(" ")[0]}</span>.</h1>
          <p className="section-lead">{t("lead")}</p>
        </div>
        <div className="dashboard-stat-grid">{stats.map((stat) => <article className="dashboard-stat" key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></article>)}</div>
        <div className="dashboard-columns">
          <section className="dashboard-panel"><div className="dashboard-panel-heading"><h2>{t("upcomingEvents")}</h2><Link href="/events">{t("viewAll")}</Link></div>
            {upcomingEvents.length ? <ul className="dashboard-list">{upcomingEvents.map((event) => <li key={event.id}><strong>{locale === "ar" ? event.titleAr || event.title : event.title}</strong><span>{event.startsAt.toLocaleDateString(locale)} · {event.location || t("locationTba")}</span></li>)}</ul> : <p className="empty-note">{t("noUpcoming")}</p>}
          </section>
          <section className="dashboard-panel"><div className="dashboard-panel-heading"><h2>{t("recentActivity")}</h2><Link href="/notifications">{t("notifications")}</Link></div>
            {activity.length ? <ul className="dashboard-list">{activity.slice(0, 5).map((item) => <li key={item.id}><strong>{item.label}</strong><span>{item.date.toLocaleString(locale)}</span></li>)}</ul> : <p className="empty-note">{t("updates")}</p>}
          </section>
        </div>
        {links.length > 0 && <nav className="dashboard-admin-links" aria-label={t("adminNav")}>{links.map((link) => <Link className="button button-secondary" href={link.href} key={link.href}>{link.label}</Link>)}</nav>}
      </section>
    </main>
  );
}
