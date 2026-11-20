import type { Metadata } from "next";
import { AboutPageClient } from "@/components/about-page-client";
import { buildPageMetadata, publicPageDescriptions } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") return {};
  return buildPageMetadata({
    locale,
    path: "/about",
    titleTagline: { en: "About the club", ar: "عن النادي" },
    description: publicPageDescriptions.about,
  });
}

export default function AboutPage() {
  return <AboutPageClient />;
}
