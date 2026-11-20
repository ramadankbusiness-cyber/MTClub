import type { Metadata } from "next";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { ResetPasswordForm } from "@/components/password-reset-forms";
import { getTranslations } from "next-intl/server";
import { buildPageMetadata, publicPageDescriptions } from "@/lib/seo";

type ResetPasswordPageProps = { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> };

export async function generateMetadata({ params }: ResetPasswordPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") return {};
  return buildPageMetadata({
    locale,
    path: "/reset-password",
    titleTagline: { en: "Choose a new password", ar: "اختيار كلمة مرور جديدة" },
    description: publicPageDescriptions.resetPassword,
  });
}

export default async function ResetPasswordPage({ params, searchParams }: ResetPasswordPageProps) {
  const [{ locale }, { token = "" }] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "site.passwordReset" });
  return (
    <main id="main-content" className="login-page">
      <div className="login-glow login-glow-a" aria-hidden="true" />
      <div className="login-glow login-glow-b" aria-hidden="true" />
      <section className="login-card" aria-labelledby="reset-password-title">
        <div className="login-brand"><Image src="/mt-logo.png" alt="MT Club logo" width={42} height={42} priority /><span>MT Club</span></div>
        <h1 id="reset-password-title">{t("newTitle")}</h1>
        <p className="login-subtitle">{t("newLead")}</p>
        <ResetPasswordForm token={token} />
        <Link className="login-inline-link" href="/login">{t("backToLogin")}</Link>
      </section>
    </main>
  );
}
