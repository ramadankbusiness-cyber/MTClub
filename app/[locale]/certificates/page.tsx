import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth-guards";
import { CertificatesPanel } from "@/components/certificates-panel";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "الشهادات" : "Certificates", robots: { index: false, follow: false } };
}

export default async function CertificatesPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.pages.certificates" });
  const access = await requirePermission("certificates.read.own");
  if ("error" in access) redirect("/login?message=login-required");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <CertificatesPanel locale={locale} />
      </section>
    </main>
  );
}
