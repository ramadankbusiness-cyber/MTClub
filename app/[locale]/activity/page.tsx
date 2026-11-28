import { redirect } from "next/navigation";
import { ActivityHistory } from "@/components/activity-history";
import { requirePermission } from "@/lib/auth-guards";
import { getTranslations } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "سجل النشاط" : "Activity history", robots: { index: false, follow: false } };
}

export default async function ActivityPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.activity" });
  const access = await requirePermission("profile.read.own");
  if ("error" in access) redirect("/login?message=login-required");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <ActivityHistory />
      </section>
    </main>
  );
}
