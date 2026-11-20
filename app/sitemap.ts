import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";

const publicPaths = ["", "/about", "/events", "/team", "/join", "/forgot-password"];
const locales = ["en", "ar"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return locales.flatMap((locale) =>
    publicPaths.map((path) => ({
      url: absoluteUrl(`/${locale}${path}`),
      lastModified,
      changeFrequency: path === "" ? "weekly" : "monthly",
      priority: path === "" ? 1 : 0.7,
      alternates: {
        languages: {
          en: absoluteUrl(`/en${path}`),
          ar: absoluteUrl(`/ar${path}`),
        },
      },
    })),
  );
}
