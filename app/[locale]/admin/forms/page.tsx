import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { FORM_INCLUDE_MANAGE } from "@/lib/forms";
import { AdminFormManager } from "@/components/admin-form-manager";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "إدارة النماذج" : "Manage forms", robots: { index: false, follow: false } };
}

export default async function AdminFormsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.admin.forms" });
  const access = await requirePermission("forms.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const where: Record<string, unknown> = access.user.role === "LEADER"
    ? { OR: [{ createdById: access.user.id }, { eventLinks: { some: { event: { committeeId: access.user.committeeId ?? "__none__" } } } }] }
    : {};
  const forms = await prisma.form.findMany({ where, include: FORM_INCLUDE_MANAGE, orderBy: { updatedAt: "desc" }, take: 100 });
  return (
    <section className="page-section">
      <div className="container">
        <div className="section-head">
          <p className="section-eyebrow">{t("title")}</p>
          <h1>{t("title")}</h1>
          <p>{t("lead")}</p>
        </div>
        <AdminFormManager initialForms={JSON.parse(JSON.stringify(forms))} locale={locale} />
      </div>
    </section>
  );
}
