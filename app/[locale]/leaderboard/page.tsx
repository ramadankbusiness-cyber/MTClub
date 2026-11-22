import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { LeaderboardView } from "@/components/leaderboard-view";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "لوحة المتصدرين" : "Leaderboard", robots: { index: false, follow: false } };
}

export default async function LeaderboardPage({ params }: Props) {
  const { locale } = await params;
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login?message=login-required");
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading">
          <p className="eyebrow">{locale === "ar" ? "النشاط" : "Activity"}</p>
          <h1>{locale === "ar" ? "لوحة المتصدرين" : "Leaderboard"}</h1>
          <p className="section-lead">{locale === "ar" ? "الأعضاء الأكثر نشاطًا حسب النقاط والحضور." : "Most active members by points and attendance."}</p>
        </div>
        <LeaderboardView locale={locale} />
      </section>
    </main>
  );
}
