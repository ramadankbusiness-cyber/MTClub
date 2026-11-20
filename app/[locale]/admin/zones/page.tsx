import { redirect } from "next/navigation";
import { AdminZoneManager } from "@/components/admin-zone-manager";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { listClubCommittees } from "@/lib/committees";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "مناطق الحضور" : "Attendance zones", robots: { index: false, follow: false } };
}

export default async function AdminZonesPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminPages.zones" });
  const access = await requirePermission("zones.manage");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const [zones, committees] = await Promise.all([
    prisma.zone.findMany({ include: { committee: { select: { name: true } } }, orderBy: { name: "asc" } }),
    listClubCommittees(),
  ]);
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <AdminZoneManager initialZones={zones} committees={committees} />
      </section>
    </main>
  );
}
