import { BrandedErrorScreen } from "@/components/branded-error-screen";

export const metadata = { title: "Offline", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return <BrandedErrorScreen variant="offline" />;
}
