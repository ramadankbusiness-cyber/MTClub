"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Field = { id: string; type: string; label: string; labelAr?: string|null; description?: string|null; descriptionAr?: string|null; required: boolean; options?: unknown };
type Form = { id: string; publicSlug: string; title: string; titleAr?: string|null; description?: string|null; descriptionAr?: string|null; accessMode: string; status: string; isOpen: boolean; openReason?: string|null; fields: Field[] };

export function PublicFormRenderer({ slug, locale }: { slug: string; locale: string }) {
  const t = useTranslations("site.admin.forms");
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/public/forms/${slug}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!alive) return;
      if (res.status === 401) { setAuthRequired(true); setLoading(false); return; }
      if (!res.ok) { setError(data?.error || t("formNotFound")); setLoading(false); return; }
      setForm(data.form); setLoading(false);
    })();
    return () => { alive = false; };
  }, [slug, t]);

  const isAr = locale === "ar";
  const title = useMemo(() => (isAr && form?.titleAr) ? form.titleAr : form?.title, [form, isAr]);
  const desc = useMemo(() => (isAr && form?.descriptionAr) ? form.descriptionAr : form?.description, [form, isAr]);

  function setValue(fieldId: string, value: unknown) { setAnswers((cur) => ({ ...cur, [fieldId]: value })); }

  async function uploadFile(fieldId: string, file: File) {
    setUploading(fieldId); setError("");
    try {
      const fd = new FormData(); fd.append("fieldId", fieldId); fd.append("file", file);
      const res = await fetch(`/api/public/forms/${slug}/upload`, { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("saveError"));
      setValue(fieldId, data.file);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("saveError")); }
    finally { setUploading(null); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true); setError("");
    try {
      const payload = { answers: form.fields.map((f) => ({ fieldId: f.id, value: answers[f.id] })), website: "" };
      const res = await fetch(`/api/public/forms/${slug}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("saveError"));
      setSubmitted(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("saveError")); }
    finally { setSubmitting(false); }
  }

  if (loading) return <p>...</p>;
  if (authRequired) return <div className="card" style={{ padding: 24 }}><h1>{t("formNotFound")}</h1><p>Please log in to access this form.</p><a className="button button-primary" href={`/${locale}/login`}>Login</a></div>;
  if (error && !form) return <div className="card" style={{ padding: 24 }}><p>{error}</p></div>;
  if (!form) return null;
  if (submitted) return <div className="card" style={{ padding: 24 }}><h1>{title}</h1><p role="status">{t("submitSuccess")}</p></div>;
  if (!form.isOpen) return <div className="card" style={{ padding: 24 }}><h1>{title}</h1><p>{t("closedMsg")}</p></div>;

  return (
    <form className="card" style={{ padding: 24, display: "grid", gap: 16 }} onSubmit={submit} dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {form.fields.map((f) => {
        const label = (isAr && f.labelAr) ? f.labelAr : f.label;
        const description = (isAr && f.descriptionAr) ? f.descriptionAr : f.description;
        const v = answers[f.id];
        return (
          <div key={f.id}>
            <label style={{ display: "block", marginBottom: 6 }}><strong>{label}{f.required ? " *" : ""}</strong></label>
            {description && <p style={{ marginTop: 0 }}><small>{description}</small></p>}
            {f.type === "SHORT_ANSWER" && <input className="input" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required} />}
            {f.type === "PARAGRAPH" && <textarea className="input" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required} />}
            {f.type === "EMAIL" && <input className="input" type="email" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required} />}
            {f.type === "PHONE" && <input className="input" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required} />}
            {f.type === "NUMBER" && <input className="input" type="number" value={typeof v === "number" || typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value === "" ? "" : Number(e.target.value))} required={f.required} />}
            {f.type === "DATE" && <input className="input" type="date" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required} />}
            {f.type === "TIME" && <input className="input" type="time" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required} />}
            {f.type === "DROPDOWN" && <select className="input" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} required={f.required}><option value="">{t("selectOption")}</option>{(Array.isArray(f.options)?f.options:[]).map((o: string) => <option key={o} value={o}>{o}</option>)}</select>}
            {f.type === "MULTIPLE_CHOICE" && (Array.isArray(f.options)?f.options:[]).map((o: string) => <div key={o}><label><input type="radio" name={f.id} value={o} checked={v === o} onChange={() => setValue(f.id, o)} required={f.required} /> {o}</label></div>)}
            {f.type === "CHECKBOXES" && (Array.isArray(f.options)?f.options:[]).map((o: string) => { const arr = Array.isArray(v) ? v : []; return <div key={o}><label><input type="checkbox" checked={arr.includes(o)} onChange={(e) => { const next = e.target.checked ? [...arr, o] : arr.filter((x: string) => x !== o); setValue(f.id, next); }} /> {o}</label></div>; })}
            {f.type === "FILE_UPLOAD" && <div><input className="input" type="file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadFile(f.id, file); }} />{uploading === f.id && <small>{t("uploading")}</small>}{typeof v === "object" && v && (v as {fileName?:string}).fileName && <small>{(v as {fileName?:string}).fileName}</small>}</div>}
          </div>
        );
      })}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div><button className="button button-primary" type="submit" disabled={submitting || !!uploading}>{submitting ? t("submitting") : t("submit")}</button></div>
    </form>
  );
}
