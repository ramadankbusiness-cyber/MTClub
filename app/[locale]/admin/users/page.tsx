import { redirect } from "next/navigation";
import { AdminUserManager } from "@/components/admin-user-manager";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { listClubCommittees } from "@/lib/committees";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "إدارة الحسابات" : "Manage accounts", robots: { index: false, follow: false } };
}

export default async function AdminUsersPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminPages.users" });
  const access = await requirePermission("users.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const [users, committees] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, email: true, phone: true, academicNumber: true, clubId: true,
        role: true, position: true, isMTC: true, committeeId: true,
        committee: { select: { id: true, key: true, name: true, nameAr: true, type: true } },
        isActive: true, mustChangePassword: true,
      },
    }),
    listClubCommittees(null, { includeMTC: true }),
  ]);
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <AdminUserManager initialUsers={users} committees={committees} userRole={access.user.role} userCommitteeId={access.user.committeeId} />
      </section>
    </main>
  );
}
