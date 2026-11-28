"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Linked = { linkId: string; kind: string; form: { id: string; title: string; status: string; publicSlug: string; responseCount: number } };
type FormOpt = { id: string; title: string };

export function EventFormsPanel({ eventId }: { eventId: string }) {
  const t = useTranslations("site.admin.forms.eventPanel");
  const [items, setItems] = useState<Linked[]>([]);
  const [allForms, setAllForms] = useState<FormOpt[]>([]);
  const [attachId, setAttachId] = useState("");
  const [attachKind, setAttachKind] = useState<"REGISTRATION"|"FEEDBACK"|"GENERAL">("GENERAL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    const [res, formsRes] = await Promise.all([
      fetch(`/api/events/${eventId}/forms`, { cache: "no-store" }),
      fetch(`/api/forms`, { cache: "no-store" }),
    ]);
    const data = await res.json().catch(() => null);
    const formsData = await formsRes.json().catch(() => null);
    if (res.ok) setItems(data.forms || []);
    if (formsRes.ok) setAllForms((formsData.forms || []).map((f: { id: string; title: string }) => ({ id: f.id, title: f.title })));
    setLoading(false);
  }
  useEffect(() => { void load(); }, [eventId]);
  async function create(kind: "REGISTRATION" | "FEEDBACK") {
    setBusy(kind); setError("");
    try {
      const res = await fetch(`/api/events/${eventId}/forms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", kind }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
  }
  async function attach() {
    if (!attachId) return;
    setBusy("attach"); setError("");
    try {
      const res = await fetch(`/api/events/${eventId}/forms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "attach", formId: attachId, kind: attachKind }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      setAttachId(""); await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
  }
  const kindLabel = (k: string) => k === "REGISTRATION" ? t("kindRegistration") : k === "FEEDBACK" ? t("kindFeedback") : t("kindGeneral");
  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border,#ddd)", borderRadius: 8 }}>
      <strong>{t("panelTitle")}</strong>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        <button className="button button-secondary" type="button" disabled={busy==="REGISTRATION"} onClick={() => void create("REGISTRATION")}>{t("createRegistration")}</button>
        <button className="button button-secondary" type="button" disabled={busy==="FEEDBACK"} onClick={() => void create("FEEDBACK")}>{t("createFeedback")}</button>
        <Link className="button button-secondary" href="/admin/forms">{t("allForms")}</Link>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        <select className="input" aria-label={t("attachExisting")} value={attachId} onChange={(e) => setAttachId(e.target.value)}><option value="">{t("attachExisting")}</option>{allForms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
        <select className="input" value={attachKind} onChange={(e) => setAttachKind(e.target.value as "REGISTRATION"|"FEEDBACK"|"GENERAL")}><option value="REGISTRATION">{t("kindRegistration")}</option><option value="FEEDBACK">{t("kindFeedback")}</option><option value="GENERAL">{t("kindGeneral")}</option></select>
        <button className="button button-secondary" type="button" disabled={!attachId || busy==="attach"} onClick={() => void attach()}>{t("attach")}</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p>...</p> : items.length === 0 ? <p>{t("noLinked")}</p> : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((l) => (
            <li key={l.linkId}>
              {l.form.title} [{kindLabel(l.kind)}] - {l.form.status} - {l.form.responseCount}
              {" "}<Link href={`/admin/forms/${l.form.id}`}>{t("edit")}</Link>
              {" "}<Link href={`/admin/forms/${l.form.id}/responses`}>{t("responses")}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
