import { HomeContent } from "@/components/home-sections";
import { getCurrentUser } from "@/lib/auth-guards";
import { siteConfig } from "@/config/site";

export default async function HomePage() {
  let isAuthenticated = false;
  try {
    const user = await getCurrentUser();
    isAuthenticated = !!user?.isActive;
  } catch {
    isAuthenticated = false;
  }

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    alternateName: "MT",
    url: `${siteConfig.url}/`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
      <main id="main-content"><HomeContent isAuthenticated={isAuthenticated} /></main>
    </>
  );
}
