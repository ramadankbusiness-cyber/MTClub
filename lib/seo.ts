import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";

type PublicPageMeta = {
  locale: "en" | "ar";
  path: string; // locale-less path, e.g. "" for home, "/about"
  titleTagline: { en: string; ar: string };
  description: { en: string; ar: string };
  noIndex?: boolean;
};

export const publicPageDescriptions = {
  home: {
    en: "MT Club is a student community in Borg El Arab, Alexandria where members learn, create, and grow together through workshops, projects, and events.",
    ar: "نادي MT مجتمع طلابي في برج العرب بالإسكندرية يجمع الأعضاء للتعلم والإبداع والنمو معًا عبر ورش العمل والمشاريع والفعاليات.",
  },
  about: {
    en: "Learn what MT Club is, what MT stands for, and how our committees help members learn, create, and connect in Borg El Arab, Alexandria.",
    ar: "تعرّف على نادي MT، ومعنى اسم MT، وكيف تساعد لجاننا الأعضاء على التعلم والإبداع والتواصل في برج العرب بالإسكندرية.",
  },
  events: {
    en: "Explore upcoming and recent MT Club events in Borg El Arab, Alexandria, including workshops, activities, and community gatherings for members.",
    ar: "استكشف فعاليات نادي MT القادمة والسابقة في برج العرب بالإسكندرية، بما في ذلك ورش العمل والأنشطة ولقاءات المجتمع للأعضاء.",
  },
  team: {
    en: "Meet the MT Club team and committee leaders in Borg El Arab, Alexandria who support members, organize activities, and build community.",
    ar: "تعرّف على فريق نادي MT وقادة اللجان في برج العرب بالإسكندرية الذين يدعمون الأعضاء وينظمون الأنشطة ويبنون المجتمع.",
  },
  join: {
    en: "Apply to join MT Club in Borg El Arab, Alexandria. Choose committees, share your interests, and become part of a creative student community.",
    ar: "قدّم للانضمام إلى نادي MT في برج العرب بالإسكندرية. اختر اللجان وشارك اهتماماتك وكن جزءًا من مجتمع طلابي إبداعي.",
  },
  forgotPassword: {
    en: "Request a secure password reset link for your MT Club account so you can regain access and continue participating in club activities.",
    ar: "اطلب رابطًا آمنًا لإعادة تعيين كلمة المرور لحسابك في نادي MT لاستعادة الوصول ومتابعة المشاركة في أنشطة النادي.",
  },
  resetPassword: {
    en: "Set a new password for your MT Club account securely and return to your dashboard, events, and member activities in the club.",
    ar: "عيّن كلمة مرور جديدة لحسابك في نادي MT بأمان وعد إلى لوحة التحكم والفعاليات وأنشطة الأعضاء في النادي.",
  },
  login: {
    en: "Log in to your MT Club account to access your dashboard, attendance, notifications, and member tools in Borg El Arab, Alexandria.",
    ar: "سجّل الدخول إلى حسابك في نادي MT للوصول إلى لوحة التحكم والحضور والإشعارات وأدوات الأعضاء في برج العرب بالإسكندرية.",
  },
} as const;

export function buildPageMetadata({
  locale,
  path,
  titleTagline,
  description,
  noIndex = false,
}: PublicPageMeta): Metadata {
  const localePath = `/${locale}${path}`;
  const canonical = absoluteUrl(localePath);
  const title = `MT Club | ${titleTagline[locale]}`;
  const desc = description[locale];
  const image = {
    url: absoluteUrl(siteConfig.ogImage),
    width: 1200,
    height: 630,
    alt: "MT Club",
  };
  return {
    metadataBase: new URL(siteConfig.url),
    title,
    description: desc,
    alternates: {
      canonical,
      languages: {
        en: absoluteUrl(`/en${path}`),
        ar: absoluteUrl(`/ar${path}`),
        "x-default": absoluteUrl(`/en${path}`),
      },
    },
    openGraph: {
      title,
      description: desc,
      url: canonical,
      siteName: siteConfig.name,
      locale: locale === "ar" ? "ar_EG" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_EG",
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: desc,
      images: [image.url],
    },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
  };
}
