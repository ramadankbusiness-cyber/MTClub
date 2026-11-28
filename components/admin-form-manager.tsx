"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "@/i18n/navigation";

type FormRow = {
  id: string; publicSlug: string; title: string; titleAr?: string | null; status: string; accessMode: string; updatedAt: string;
  _count?: { submissions: number };
};

const TEMPLATES = ["event-registration","member-application","event-feedback","attendance-confirmation","committee-application"];

export function AdminFormManager({ initialForms, locale }: { initialForms: FormRow[]; locale: string }) {
  const t = useTranslations("site.admin.forms");
  const router = useRouter();
  const [forms, setForms] = useState<FormRow[]>(initialForms);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return forms;
    return forms.filter((f) => [f.title, f.titleAr, f.status, f.accessMode].filter(Boolean).join(" ").toLowerCase().includes(s));
  }, [forms, q]);

  async function refresh() {
    const res = await fetch("/api/forms", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (res.ok && Array.isArray(data?.forms)) setForms(data.forms);
  }

  async function createBlank() {
    setBusy("create");
    setMessage("");
    try {
      const res = await fetch("/api/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: locale === "ar" ? "نموذج بدون عنوان" : "Untitled form", accessMode: "MEMBERS_ONLY", duplicatePolicy: "ALLOW", fields: [] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveError"));
      await refresh();
      router.push(`/admin/forms/${data.form.id}`);
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  async function createFromTemplate(templateKey: string) {
    setBusy(`tpl:${templateKey}`);
    setMessage("");
    try {
      const res = await fetch("/api/forms/templates/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateKey }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveError"));
      await refresh();
      router.push(`/admin/forms/${data.form.id}`);
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  async function duplicate(id: string) {
    if (!window.confirm(t("duplicateConfirm"))) return;
    setBusy(`dup:${id}`);
    try {
      const res = await fetch(`/api/forms/${id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveError"));
      await refresh();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    setBusy(`del:${id}`);
    try {
      const res = await fetch(`/api/forms/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("saveError"));
      setForms((cur) => cur.filter((f) => f.id !== id));
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  async function quickStatus(id: string, status: string) {
    setBusy(`status:${id}`);
    setMessage("");
    try {
      const getRes = await fetch(`/api/forms/${id}`, { cache: "no-store" });
      const getData = await getRes.json();
      if (!getRes.ok) throw new Error(getData.error || t("saveError"));
      const f = getData.form;
      const res = await fetch(`/api/forms/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.title, titleAr: f.titleAr, description: f.description, descriptionAr: f.descriptionAr,
          accessMode: f.accessMode, status, opensAt: f.opensAt, closesAt: f.closesAt, maxResponses: f.maxResponses, duplicatePolicy: f.duplicatePolicy,
          fields: (f.fields ?? []).map((x: Record<string, unknown>) => ({ id: x.id, type: x.type, label: x.label, labelAr: x.labelAr, description: x.description, descriptionAr: x.descriptionAr, required: x.required, order: x.order, options: x.options, validation: x.validation })),
          eventLinks: (f.eventLinks ?? []).map((l: { event: { id: string }; kind: string }) => ({ eventId: l.event.id, kind: l.kind })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveError"));
      await refresh();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  function statusLabel(s: string) { return t(s as never) || s; }

  return (
    <div className="admin-forms">
      <div className="admin-form-toolbar" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <button className="button button-primary" type="button" onClick={createBlank} disabled={busy === "create"}>{busy === "create" ? t("saving") : t("create")}</button>
        <select className="input" aria-label={t("templates")} defaultValue="" onChange={(e) => { if (e.target.value) { void createFromTemplate(e.target.value); e.target.value = ""; } }}>
          <option value="">{t("createFromTemplate")}</option>
          {TEMPLATES.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="input" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {message && <p className="form-error" role="alert">{message}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>{t("name")}</th><th>{t("status")}</th><th>{t("access")}</th><th>{t("responses")}</th><th>{t("updated")}</th><th>{t("actions")}</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={6}>{t("noForms")}</td></tr> : filtered.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/admin/forms/${f.id}`}>{f.title}</Link></td>
                <td>{statusLabel(f.status)}</td>
                <td>{statusLabel(f.accessMode)}</td>
                <td>{f._count?.submissions ?? 0}</td>
                <td>{new Date(f.updatedAt).toLocaleString()}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="button button-secondary" href={`/admin/forms/${f.id}`}>{t("edit")}</Link>
                  <Link className="button button-secondary" href={`/admin/forms/${f.id}/responses`}>{t("responses")}</Link>
                  <Link className="button button-secondary" href={`/forms/${f.publicSlug}`} target="_blank">{t("preview")}</Link>
                  <button className="button button-secondary" type="button" onClick={() => void duplicate(f.id)} disabled={busy===`dup:${f.id}`}>{t("duplicate")}</button>
                  {f.status !== "PUBLISHED" && <button className="button button-secondary" type="button" onClick={() => void quickStatus(f.id, "PUBLISHED")} disabled={busy===`status:${f.id}`}>{t("publish")}</button>}
                  {f.status === "PUBLISHED" && <button className="button button-secondary" type="button" onClick={() => void quickStatus(f.id, "CLOSED")} disabled={busy===`status:${f.id}`}>{t("close")}</button>}
                  {f.status === "CLOSED" && <button className="button button-secondary" type="button" onClick={() => void quickStatus(f.id, "PUBLISHED")} disabled={busy===`status:${f.id}`}>{t("reopen")}</button>}
                  <button className="button button-secondary" type="button" onClick={() => void remove(f.id)} disabled={busy===`del:${f.id}`}>{t("delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
