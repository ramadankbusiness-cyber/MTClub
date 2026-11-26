import { HomeContent } from "@/components/home-sections";
import { getCurrentUser } from "@/lib/auth-guards";

export default async function HomePage() {
  let isAuthenticated = false;
  try {
    const user = await getCurrentUser();
    isAuthenticated = !!user?.isActive;
  } catch {
    isAuthenticated = false;
  }
  return <main id="main-content"><HomeContent isAuthenticated={isAuthenticated} /></main>;
}
