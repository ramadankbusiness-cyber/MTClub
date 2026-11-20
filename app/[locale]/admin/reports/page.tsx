import { redirect } from "next/navigation";
import { AttendanceReports } from "@/components/attendance-reports";
import { requirePermission } from "@/lib/auth-guards";
import { listClubCommittees } from "@/lib/committees";
import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }>; searchParams: SearchParams };

type SearchParams = Promise<{
  from?: string | string[];
  to?: string | string[];
  committeeId?: string | string[];
}>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "تقارير الحضور" : "Attendance reports", robots: { index: false, follow: false } };
}

export default async function AttendanceReportsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminPages.reports" });
  const allAccess = await requirePermission("attendance.read.all");
  let actor;
  if ("error" in allAccess) {
    const committeeAccess = await requirePermission("attendance.read.committee");
    if ("error" in committeeAccess) redirect(committeeAccess.status === 401 ? "/login?message=login-required" : "/forbidden");
    actor = committeeAccess.user;
  } else {
    actor = allAccess.user;
  }
  const isAdmin = actor.role === "ADMIN";
  const query = await searchParams;
  const rawFrom = firstValue(query.from);
  const rawTo = firstValue(query.to);
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  defaultFrom.setUTCHours(0, 0, 0, 0);
  const from = rawFrom ? parseDate(rawFrom) : defaultFrom;
  const to = rawTo ? parseDate(rawTo, true) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const invalidRange = !from || !to || from > to;
  const rangeStart = invalidRange ? defaultFrom : from;
  const rangeEnd = invalidRange ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)) : to;

  const committees = isAdmin ? await listClubCommittees(null, { includeMTC: false }) : [];
  const requestedCommittee = firstValue(query.committeeId);
  const selectedCommittee = isAdmin && requestedCommittee && committees.some((committee) => committee.id === requestedCommittee)
    ? requestedCommittee
    : null;
  const invalidCommittee = isAdmin && !!requestedCommittee && !selectedCommittee;
  const sessionScope = isAdmin
    ? selectedCommittee ? { OR: [{ committeeId: null }, { committeeId: selectedCommittee }] } : {}
    : { OR: [{ committeeId: null }, { committeeId: actor.committeeId }] };
  const userScope = isAdmin
    ? selectedCommittee ? { committeeId: selectedCommittee } : {}
    : { committeeId: actor.committeeId };

  const [sessions, users] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: { startsAt: { gte: rangeStart, lte: rangeEnd }, endsAt: { lte: now }, ...sessionScope },
      select: { id: true, startsAt: true, committeeId: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true, ...userScope },
      select: { id: true, name: true, email: true, committeeId: true, committee: { select: { key: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const records = sessions.length && users.length
    ? await prisma.attendanceRecord.findMany({
      where: { sessionId: { in: sessions.map((session) => session.id) }, userId: { in: users.map((user) => user.id) } },
      select: { userId: true, sessionId: true, status: true },
    })
    : [];
  const recordByPair = new Map(records.map((record) => [`${record.userId}:${record.sessionId}`, record.status]));

  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  let expected = 0;
  const memberRows = users.map((user) => {
    let attended = 0;
    let missed = 0;
    let excusedCount = 0;
    const eligibleSessions = sessions.filter((session) => !session.committeeId || session.committeeId === user.committeeId);
    for (const session of eligibleSessions) {
      expected += 1;
      const status = recordByPair.get(`${user.id}:${session.id}`) ?? "ABSENT";
      if (status === "PRESENT") { present += 1; attended += 1; }
      else if (status === "LATE") { late += 1; attended += 1; }
      else if (status === "EXCUSED") { excused += 1; excusedCount += 1; }
      else { absent += 1; missed += 1; }
    }
    const denominator = eligibleSessions.length - excusedCount;
    return {
      id: user.id,
      name: user.name,
      committee: user.committee?.key === "mtc" ? "Unassigned" : (user.committee?.name ?? "Unassigned"),
      attended,
      absent: missed,
      excused: excusedCount,
      eligible: eligibleSessions.length,
      rate: denominator ? Math.round(attended / denominator * 100) : 0,
    };
  }).sort((a, b) => a.rate - b.rate || b.absent - a.absent || a.name.localeCompare(b.name));

  const trendByDay = new Map<string, { date: string; expected: number; attended: number }>();
  const committeeStats = new Map<string, { committee: string; eligible: number; attended: number; excused: number }>();
  for (const session of sessions) {
    const date = dateInputValue(session.startsAt);
    const trend = trendByDay.get(date) ?? { date: date.slice(5), expected: 0, attended: 0 };
    for (const user of users) {
      if (session.committeeId && session.committeeId !== user.committeeId) continue;
      trend.expected += 1;
      const status = recordByPair.get(`${user.id}:${session.id}`) ?? "ABSENT";
      if (status === "PRESENT" || status === "LATE") trend.attended += 1;
      const committee = user.committee?.key === "mtc" ? "Unassigned" : (user.committee?.name ?? "Unassigned");
      const group = committeeStats.get(committee) ?? { committee, eligible: 0, attended: 0, excused: 0 };
      group.eligible += 1;
      if (status === "PRESENT" || status === "LATE") group.attended += 1;
      if (status === "EXCUSED") group.excused += 1;
      committeeStats.set(committee, group);
    }
    trendByDay.set(date, trend);
  }
  const committeeRows = [...committeeStats.values()].map((item) => ({
    ...item,
    rate: item.eligible - item.excused ? Math.round(item.attended / (item.eligible - item.excused) * 100) : 0,
  })).sort((a, b) => b.rate - a.rate || a.committee.localeCompare(b.committee));
  const attendanceRate = expected - excused ? Math.round((present + late) / (expected - excused) * 100) : 0;
  const exportParams = new URLSearchParams({ from: dateInputValue(rangeStart), to: dateInputValue(rangeEnd) });
  if (selectedCommittee) exportParams.set("committeeId", selectedCommittee);

  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className="section-lead">{t("lead")}</p>
        </div>
        <AttendanceReports
          from={dateInputValue(rangeStart)}
          to={dateInputValue(rangeEnd)}
          committees={committees}
          selectedCommittee={selectedCommittee ?? ""}
          invalidFilter={invalidRange || invalidCommittee}
          summary={{ sessions: sessions.length, attendanceRate, present, late, absent, excused }}
          trend={[...trendByDay.values()]}
          committeesReport={committeeRows}
          members={memberRows}
          exportHref={`/api/admin/attendance/export?${exportParams.toString()}`}
        />
      </section>
    </main>
  );
}
