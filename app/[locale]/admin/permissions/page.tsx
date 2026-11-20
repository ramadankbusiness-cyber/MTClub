import { redirect } from "next/navigation";
import { permissionRows } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth-guards";
import { getTranslations } from "next-intl/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return { title: locale === "ar" ? "مصفوفة الصلاحيات" : "Permissions matrix", robots: { index: false, follow: false } };
}

export default async function PermissionsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site.adminPages.permissions" });
  const rolesT = await getTranslations({ locale, namespace: "site.adminPages.users" });
  const access = await requirePermission("permissions.read");
  if ("error" in access) redirect(access.status === 401 ? "/login?message=login-required" : "/forbidden");
  const rows = permissionRows();
  const permissions = [...new Set(rows.flatMap((row) => row.permissions))].sort();
  return (
    <main id="main-content" className="inner-page">
      <section className="content-section page-intro">
        <div className="section-heading"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="section-lead">{t("lead")}</p></div>
        <div className="permissions-table-wrap"><table className="permissions-table">
          <thead><tr><th scope="col">{t("capability")}</th>{rows.map((row) => <th scope="col" key={row.role}>{rolesT(row.role === "ADMIN" ? "admin" : row.role === "LEADER" ? "leader" : "member")}</th>)}</tr></thead>
          <tbody>{permissions.map((permission) => <tr key={permission}><th scope="row">{permission.replaceAll(".", " · ")}</th>{rows.map((row) => <td key={row.role}>{new Set<string>(row.permissions).has(permission) ? <span className="permission-yes" aria-label={t("allowed")}>✓</span> : <span aria-label={t("denied")}>—</span>}</td>)}</tr>)}</tbody>
        </table></div>
      </section>
    </main>
  );
}
