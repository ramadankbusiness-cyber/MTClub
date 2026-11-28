import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canViewFormResponses } from "@/lib/forms";
import { AdminFormResponses } from "@/components/admin-form-responses";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; id: string }> };

export default async function AdminFormResponsesPage({ params }: Props) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "site.admin.forms" });
  const access = await requirePermission("forms.responses.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const form = await prisma.form.findUnique({ where: { id }, include: { fields: { orderBy: { order: "asc" } }, eventLinks: { include: { event: { select: { committeeId: true } } } }, _count: { select: { submissions: true } } } });
  if (!form) notFound();
  if (!canViewFormResponses(form as unknown as Parameters<typeof canViewFormResponses>[0], access.user)) redirect("/forbidden");
  return (
    <section className="page-section">
      <div className="container">
        <div className="section-head">
          <p className="section-eyebrow">{t("responsesTitle")}</p>
          <h1>{form.title}</h1>
          <p>{t("totalResponses")}: {form._count.submissions}</p>
        </div>
        <AdminFormResponses formId={form.id} />
      </div>
    </section>
  );
}
