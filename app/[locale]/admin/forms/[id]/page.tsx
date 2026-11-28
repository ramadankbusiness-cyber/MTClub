import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canManageForm, FORM_INCLUDE_MANAGE } from "@/lib/forms";
import { AdminFormBuilder } from "@/components/admin-form-builder";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; id: string }> };

export default async function AdminFormEditPage({ params }: Props) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "site.admin.forms" });
  const access = await requirePermission("forms.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const form = await prisma.form.findUnique({ where: { id }, include: FORM_INCLUDE_MANAGE });
  if (!form) notFound();
  if (!canManageForm(form as unknown as Parameters<typeof canManageForm>[0], access.user)) redirect("/forbidden");

  const events = await prisma.event.findMany({
    where: access.user.role === "LEADER" ? { committeeId: access.user.committeeId ?? "__none__" } : {},
    select: { id: true, title: true },
    orderBy: { startsAt: "desc" },
    take: 200,
  });

  return (
    <section className="page-section">
      <div className="container">
        <div className="section-head">
          <p className="section-eyebrow">{t("builderTitle")}</p>
          <h1>{form.title}</h1>
        </div>
        <AdminFormBuilder initialForm={JSON.parse(JSON.stringify(form))} events={JSON.parse(JSON.stringify(events))} />
      </div>
    </section>
  );
}
