import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/change-password-form";
import { getCurrentUser } from "@/lib/auth-guards";
import { SectionHeading } from "@/components/section-heading";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "تغيير كلمة المرور" : "Change password", robots: { index: false, follow: false } };
}

export default async function ChangePasswordPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.changePassword" });
  const user = await getCurrentUser();
  if (!user?.isActive) redirect("/login");
  if (!user.mustChangePassword) redirect("/dashboard");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro account-page">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")} />
        <ChangePasswordForm />
      </section>
    </main>
  );
}
