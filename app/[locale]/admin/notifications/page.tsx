import { redirect } from "next/navigation";
import { NotificationComposer } from "@/components/notification-composer";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { listClubCommittees } from "@/lib/committees";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "إرسال الإشعارات" : "Send notifications", robots: { index: false, follow: false } };
}

export default async function AdminNotificationsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminCommunication.notifications" });
  const access = await requirePermission("notifications.send");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const isAdmin = access.user.role === "ADMIN";
  const [committees, users] = await Promise.all([
    listClubCommittees(isAdmin ? undefined : access.user.committeeId, { includeMTC: isAdmin }),
    prisma.user.findMany({
      where: { isActive: true, ...(isAdmin ? {} : { committeeId: access.user.committeeId }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <NotificationComposer role={access.user.role} committees={committees} users={users} />
      </section>
    </main>
  );
}
