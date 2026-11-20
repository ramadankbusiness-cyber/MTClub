import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { events as fallbackEvents } from "@/data/events";
import { EventsDirectory } from "@/components/events-directory";
import { buildPageMetadata, publicPageDescriptions } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") return {};
  return buildPageMetadata({
    locale,
    path: "/events",
    titleTagline: { en: "Events and workshops", ar: "الفعاليات وورش العمل" },
    description: publicPageDescriptions.events,
  });
}

export default async function EventsPage() {
  const events = process.env.DATABASE_URL
    ? await prisma.event.findMany({ where: { published: true }, orderBy: { startsAt: "asc" }, take: 100 })
    : [];
  const now = new Date();
  const publicEvents = events.length ? events.map((event) => ({
    date: event.startsAt.toISOString().slice(0, 10),
    title: event.title,
    titleAr: event.titleAr || event.title,
    description: event.description,
    descriptionAr: event.descriptionAr || event.description,
    status: (event.startsAt >= now ? "Upcoming" : "Recent") as "Upcoming" | "Recent",
    statusAr: (event.startsAt >= now ? "قادم" : "حديث") as "قادم" | "حديث",
  })) : fallbackEvents;
  return <main id="main-content" className="inner-page"><EventsDirectory events={publicEvents} /></main>;
}
