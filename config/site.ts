export const siteConfig = {
  name: "MT Club",
  url: "https://mtclub.vercel.app",
  defaultLocale: "en",
  locales: ["en", "ar"] as const,
  ogImage: "/opengraph-image",
  logo: "/mt-logo.png",
  // Clearly marked placeholder list: replace with MT Club's official social media profile URLs.
  // Leave as empty strings until verified URLs are available.
  sameAs: [
    "https://www.facebook.com/REPLACE_WITH_MT_CLUB_PAGE",
    "https://www.instagram.com/REPLACE_WITH_MT_CLUB_PROFILE",
    "https://www.linkedin.com/company/REPLACE_WITH_MT_CLUB_PAGE",
    "https://x.com/REPLACE_WITH_MT_CLUB_PROFILE",
  ],
} as const;

export function absoluteUrl(path = "/") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${siteConfig.url}${normalized}`;
}
