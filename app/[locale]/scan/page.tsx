import { requireUser } from "@/lib/auth-guards";
import { getTranslations } from "next-intl/server";
import { ScanAttendanceClient } from "@/components/scan-attendance";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "مسح رمز الحضور" : "Scan QR" };
}

export default async function ScanAttendancePage({ params }: Props) {
  const { locale } = await params;
  await requireUser();
  const t = await getTranslations({ locale, namespace: "site.pages.attendance" });
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("scan")}</h1>
          <p className="section-lead">{t("scanHint")}</p>
        </div>
        <ScanAttendanceClient />
      </section>
    </main>
  );
}
