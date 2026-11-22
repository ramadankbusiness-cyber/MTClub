import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { AdminPointsManager } from "@/components/admin-points-manager";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "إدارة النقاط" : "Points management", robots: { index: false, follow: false } };
}

export default async function AdminPointsPage({ params }: Props) {
  const { locale } = await params;
  const access = await requirePermission("points.view");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading">
          <p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p>
          <h1>{locale === "ar" ? "إدارة النقاط" : "Points management"}</h1>
          <p className="section-lead">{locale === "ar" ? "إدارة نقاط الأعضاء ومراجعة سجل المعاملات." : "Manage member points and review transaction history."}</p>
        </div>
        <AdminPointsManager canManage={access.user.role === "ADMIN"} locale={locale} />
      </section>
    </main>
  );
}
