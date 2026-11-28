import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canAccessCommittee } from "@/lib/permissions";
import { EventDashboard } from "@/components/event-dashboard";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; id: string }> };

export default async function EventDashboardPage({ params }: Props) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "site.admin.eventDashboard" });
  const access = await requirePermission("events.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");

  const event = await prisma.event.findUnique({ where: { id }, select: { id: true, title: true, titleAr: true, committeeId: true } });
  if (!event) notFound();
  const isAdmin = access.user.role === "ADMIN";
  const isLeader = access.user.role === "LEADER" && canAccessCommittee(access.user, event.committeeId);
  if (!isAdmin && !isLeader) redirect("/forbidden");

  return (
    <section className="page-section">
      <div className="container">
        <div className="section-head">
          <p className="section-eyebrow">{t("title")}</p>
          <h1>{locale === "ar" ? event.titleAr || event.title : event.title}</h1>
        </div>
        <EventDashboard eventId={id} locale={locale} />
      </div>
    </section>
  );
}
