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
    en: "MT Club (Medical Technology) is a community where members learn, create, and grow together through workshops, projects, and events across its committees.",
    ar: "نادي MT (التكنولوجيا الطبية) هو مجتمع يجمع الأعضاء للتعلم والإبداع والنمو معًا من خلال ورش العمل والمشاريع والفعاليات والأنشطة المتنوعة في مختلف لجانه.",
  },
  about: {
    en: "Learn what MT Club is, what MT stands for as Medical Technology, and how its committees help members learn, create, connect, collaborate, and grow together.",
    ar: "تعرّف على نادي MT وما يرمز إليه اسم التكنولوجيا الطبية، وكيف تساعد لجانه الأعضاء على التعلم والإبداع والتواصل والتعاون والنمو معًا داخل مجتمع النادي.",
  },
  events: {
    en: "Explore upcoming and recent MT Club events, including workshops, projects, activities, and community gatherings organized for members across its committees.",
    ar: "استكشف فعاليات نادي MT القادمة والسابقة، بما في ذلك ورش العمل والمشاريع والأنشطة ولقاءات المجتمع التي تُنظَّم لأعضاء النادي في مختلف اللجان.",
  },
  team: {
    en: "Meet the MT Club team and committee leaders who support members, organize activities and events, and help the Medical Technology community grow together.",
    ar: "تعرّف على فريق نادي MT وقادة لجانه الذين يدعمون الأعضاء وينظمون الأنشطة والفعاليات ويساعدون مجتمع التكنولوجيا الطبية على التعلم والنمو معًا باستمرار.",
  },
  join: {
    en: "Apply to join MT Club, the Medical Technology community. Choose committees, share your interests, and learn, create, collaborate, and grow with members.",
    ar: "قدّم للانضمام إلى نادي MT، مجتمع التكنولوجيا الطبية. اختر اللجان وشارك اهتماماتك وتعلّم وابدع وتعاون وانمُ مع أعضاء النادي في أنشطته المتنوعة.",
  },
  forgotPassword: {
    en: "Request a secure password reset link for your MT Club account to regain access to your member dashboard, attendance, notifications, and club activities.",
    ar: "اطلب رابطًا آمنًا لإعادة تعيين كلمة مرور حسابك في نادي MT لاستعادة الوصول إلى لوحة التحكم والحضور والإشعارات وأنشطة الأعضاء في أنشطة النادي.",
  },
  resetPassword: {
    en: "Set a new password for your MT Club account securely, then return to your member dashboard, attendance, notifications, profile, and club activities.",
    ar: "عيّن كلمة مرور جديدة لحسابك في نادي MT بأمان، ثم عُد إلى لوحة تحكم الأعضاء والحضور والإشعارات والملف الشخصي وأنشطة النادي الخاصة بالأعضاء.",
  },
  login: {
    en: "Log in to your MT Club account to access your dashboard, attendance, notifications, profile, and member tools for Medical Technology club activities.",
    ar: "سجّل الدخول إلى حسابك في نادي MT للوصول إلى لوحة التحكم والحضور والإشعارات والملف الشخصي وأدوات الأعضاء لأنشطة نادي التكنولوجيا الطبية.",
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
