import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { absoluteUrl, siteConfig } from "@/config/site";

const description =
  "MT Club is a student community in Borg El Arab, Alexandria where members learn, create, and grow together through workshops, projects, and events.";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "MT Club | Learn, create, and grow together",
    template: "%s",
  },
  description,
  alternates: {
    canonical: absoluteUrl("/en"),
    languages: {
      en: absoluteUrl("/en"),
      ar: absoluteUrl("/ar"),
      "x-default": absoluteUrl("/en"),
    },
  },
  openGraph: {
    title: "MT Club | Learn, create, and grow together",
    description,
    url: absoluteUrl("/en"),
    siteName: siteConfig.name,
    locale: "en_US",
    alternateLocale: "ar_EG",
    type: "website",
    images: [{ url: absoluteUrl(siteConfig.ogImage), width: 1200, height: 630, alt: "MT Club" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MT Club | Learn, create, and grow together",
    description,
    images: [absoluteUrl(siteConfig.ogImage)],
  },
  icons: {
    icon: siteConfig.logo,
    shortcut: siteConfig.logo,
    apple: siteConfig.logo,
  },
  manifest: "/manifest.json",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await headers()).get("x-mt-locale") === "ar" ? "ar" : "en";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: siteConfig.url,
    logo: absoluteUrl(siteConfig.logo),
    sameAs: siteConfig.sameAs,
  };

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body className={locale === "ar" ? "locale-ar" : "locale-en"} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
