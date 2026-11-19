import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { HomeContent } from "@/components/home-sections";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.home" });

  const stats: { value: string; label: string }[] = [];
  try {
    const [members, committees, events] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.committee.count({ where: { key: { not: "mtc" } } }),
      prisma.event.count({ where: { published: true } }),
    ]);
    if (members > 0) stats.push({ value: String(members), label: t("statsLabels.members") });
    if (committees > 0) stats.push({ value: String(committees), label: t("statsLabels.committees") });
    if (events > 0) stats.push({ value: String(events), label: t("statsLabels.events") });
  } catch {
    // No reliable database-backed statistics available.
  }

  return <main id="main-content"><HomeContent stats={stats} /></main>;
}
