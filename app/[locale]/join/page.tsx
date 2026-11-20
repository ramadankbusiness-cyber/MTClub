import type { Metadata } from "next";
import { JoinPageClient } from "@/components/join-page-client";
import { buildPageMetadata, publicPageDescriptions } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") return {};
  return buildPageMetadata({
    locale,
    path: "/join",
    titleTagline: { en: "Join the club", ar: "انضم إلى النادي" },
    description: publicPageDescriptions.join,
  });
}

export default function JoinPage() {
  return <JoinPageClient />;
}
