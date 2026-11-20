import { BrandedErrorScreen } from "@/components/branded-error-screen";

export const metadata = { title: "No access", robots: { index: false, follow: false } };

export default function ForbiddenPage() {
  return <BrandedErrorScreen variant="403" />;
}
