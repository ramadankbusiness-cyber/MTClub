import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { SiteProvider } from "@/components/site-provider";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import { PwaRegistrar } from "@/components/pwa-registrar";
import { AppToastProvider } from "@/components/app-toast-provider";
import { routing } from "@/i18n/routing";
import { buildPageMetadata, publicPageDescriptions } from "@/lib/seo";

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") return {};
  return buildPageMetadata({
    locale,
    path: "",
    titleTagline: { en: "Learn, create, and grow together", ar: "نتعلم ونبدع وننمو معًا" },
    description: publicPageDescriptions.home,
  });
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <AuthSessionProvider>
        <AppToastProvider>
          <SiteProvider>
            <a href="#main-content" className="skip-link">
              Skip to content
            </a>
            <Navbar />
            {children}
            <Footer />
            <PwaRegistrar />
          </SiteProvider>
        </AppToastProvider>
      </AuthSessionProvider>
    </NextIntlClientProvider>
  );
}
