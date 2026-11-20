import { redirect } from "next/navigation";
import { NotificationCenter } from "@/components/notification-center";
import { requirePermission } from "@/lib/auth-guards";
import { getTranslations } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "الإشعارات" : "Notifications", robots: { index: false, follow: false } };
}

export default async function NotificationsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.pages.notifications" });
  const access = await requirePermission("notifications.read");
  if ("error" in access) redirect("/login?message=login-required");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <NotificationCenter />
      </section>
    </main>
  );
}
