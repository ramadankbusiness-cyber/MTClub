import { redirect } from "next/navigation";
import { AdminActivityReview } from "@/components/admin-activity-review";
import { requirePermission } from "@/lib/auth-guards";
import { getTranslations } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "مراجعة النشاط" : "Activity review", robots: { index: false, follow: false } };
}

export default async function AdminActivityPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminPages.activity" });
  const access = await requirePermission("audit.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <AdminActivityReview />
      </section>
    </main>
  );
}
