import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { MemberPointsCard } from "@/components/member-points-card";
import { requirePermission } from "@/lib/auth-guards";
import { getTranslations } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "ملفي الشخصي" : "My profile", robots: { index: false, follow: false } };
}

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.pages.profile" });
  const access = await requirePermission("profile.read.own");
  if ("error" in access) redirect("/login?message=login-required");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <ProfileForm initialName={access.user.name} email={access.user.email} initialPhone={access.user.phone} initialPhoto={access.user.photoUrl} />
        <MemberPointsCard locale={locale} />
      </section>
    </main>
  );
}
