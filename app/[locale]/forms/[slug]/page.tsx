import { PublicFormRenderer } from "@/components/public-form-renderer";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function PublicFormPage({ params }: Props) {
  const { locale, slug } = await params;
  return (
    <section className="page-section">
      <div className="container" style={{ maxWidth: 860 }}>
        <PublicFormRenderer slug={slug} locale={locale} />
      </div>
    </section>
  );
}
