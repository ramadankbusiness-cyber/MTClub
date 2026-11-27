import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, isAccountLinkingComplete } from "@/lib/auth-guards";
import { AccountLinkingPanel } from "@/components/account-linking-panel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "ربط الحسابات" : "Link accounts", robots: { index: false, follow: false } };
}

export default async function AccountLinkingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "site.accountLinking" });
  const user = await getCurrentUser();
  if (!user || !user.isActive) redirect("/login?message=login-required");
  if (user.mustChangePassword) redirect("/change-password");
  if (isAccountLinkingComplete(user)) redirect("/dashboard");

  const googleStatus = typeof sp.google === "string" ? sp.google : undefined;

  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className="section-lead">{t("lead")}</p>
        </div>
        <AccountLinkingPanel
          locale={locale}
          initialStatus={{
            googleLinked: !!user.googleSubject,
            googleEmail: user.googleEmail,
            telegramLinked: !!user.telegramUserId,
            telegramUsername: user.telegramUsername,
            complete: false,
          }}
          googleStatus={googleStatus}
        />
      </section>
    </main>
  );
}
