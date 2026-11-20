import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { getLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "سجل المراجعة" : "Audit log", robots: { index: false, follow: false } };
}

export default async function AuditLogPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminPages.audit" });
  const activeLocale = await getLocale();
  const access = await requirePermission("audit.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const entries = await prisma.auditLog.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { name: true, email: true } } },
  });
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <div className="audit-table-wrap"><table className="audit-table">
          <thead><tr><th scope="col">{t("when")}</th><th scope="col">{t("actor")}</th><th scope="col">{t("action")}</th><th scope="col">{t("target")}</th><th scope="col">{t("details")}</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id}>
            <td>{entry.createdAt.toLocaleString(activeLocale)}</td>
            <td>{entry.actor?.name ?? t("system")}{entry.actor?.email ? <small>{entry.actor.email}</small> : null}</td>
            <td>{entry.action.replaceAll(".", " ")}</td>
            <td>{entry.targetType}{entry.targetId ? <small>{entry.targetId}</small> : null}</td>
            <td>{entry.details ? JSON.stringify(entry.details) : "—"}</td>
          </tr>)}
            {!entries.length && <tr><td colSpan={5}>{t("empty")}</td></tr>}
          </tbody>
        </table></div>
      </section>
    </main>
  );
}
