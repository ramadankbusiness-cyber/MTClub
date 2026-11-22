import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { AdminAnalyticsView } from "@/components/admin-analytics-view";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "تحليلات الأعضاء" : "Member analytics", robots: { index: false, follow: false } };
}

export default async function AdminAnalyticsPage({ params }: Props) {
  const { locale } = await params;
  const access = await requirePermission("points.view");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading">
          <p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p>
          <h1>{locale === "ar" ? "تحليلات الأعضاء والنشاط" : "Member attendance & activity analytics"}</h1>
          <p className="section-lead">{locale === "ar" ? "إحصائيات حقيقية عن الحضور والنقاط والنشاط." : "Real statistics for attendance, points, and member activity."}</p>
        </div>
        <AdminAnalyticsView locale={locale} />
      </section>
    </main>
  );
}
