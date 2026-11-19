import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "leaflet/dist/leaflet.css";

const siteOrigin = process.env.NEXT_PUBLIC_APP_URL
  || process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: "MT Club — Learn, create and grow together",
    template: "%s | MT Club",
  },
  description:
    "MT Club is a community of curious people who learn, create and grow side by side through OC, HR, PR, Tech, Logistics, Media and First Aid.",
  openGraph: {
    title: "MT Club — Learn, create and grow together",
    description:
      "A community of curious people who learn, create and grow side by side.",
    type: "website",
    siteName: "MT Club",
    images: [{ url: "/mt-logo.png", width: 652, height: 652, alt: "MT Club logo" }],
  },
  icons: {
    icon: "/mt-logo.png",
    apple: "/mt-logo.png",
  },
  manifest: "/manifest.json",
  alternates: {
    languages: { en: "/en", ar: "/ar" },
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await headers()).get("x-mt-locale") === "ar" ? "ar" : "en";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
