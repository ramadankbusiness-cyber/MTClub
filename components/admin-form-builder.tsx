"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "@/i18n/navigation";

type Field = {
  id?: string; type: string; label: string; labelAr?: string | null; description?: string | null; descriptionAr?: string | null;
  required: boolean; order: number; options?: string[] | null; validation?: Record<string, unknown> | null; isArchived?: boolean;
};
type EventLink = { eventId: string; kind: string; event?: { id: string; title: string; titleAr?: string | null } };
type FormData = {
  id: string; publicSlug: string; title: string; titleAr?: string | null; description?: string | null; descriptionAr?: string | null;
  accessMode: string; status: string; opensAt?: string | null; closesAt?: string | null; maxResponses?: number | null; duplicatePolicy: string;
  fields: Field[]; eventLinks: EventLink[];
};

const TYPES = ["SHORT_ANSWER","PARAGRAPH","MULTIPLE_CHOICE","CHECKBOXES","DROPDOWN","NUMBER","DATE","TIME","EMAIL","PHONE","FILE_UPLOAD"] as const;
const choiceTypes = new Set(["MULTIPLE_CHOICE","CHECKBOXES","DROPDOWN"]);

function emptyField(order: number): Field { return { type: "SHORT_ANSWER", label: "", labelAr: "", description: "", descriptionAr: "", required: false, order, options: [], isArchived: false }; }

export function AdminFormBuilder({ initialForm, events }: { initialForm: FormData; events: { id: string; title: string }[] }) {
  const t = useTranslations("site.admin.forms");
  const router = useRouter();
  const [form, setForm] = useState<FormData>({
    ...initialForm,
    fields: (initialForm.fields || []).map((f, i) => ({ ...f, options: Array.isArray(f.options) ? f.options : [], order: i })),
    eventLinks: initialForm.eventLinks || [],
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function updateField(idx: number, patch: Partial<Field>) {
    setForm((cur) => { const fields = [...cur.fields]; fields[idx] = { ...fields[idx], ...patch }; return { ...cur, fields }; });
  }
  function addField() { setForm((cur) => ({ ...cur, fields: [...cur.fields, emptyField(cur.fields.length)] })); }
  function removeField(idx: number) { setForm((cur) => ({ ...cur, fields: cur.fields.filter((_, i) => i !== idx).map((f, i) => ({ ...f, order: i })) })); }
  function moveField(idx: number, dir: -1 | 1) {
    setForm((cur) => {
      const fields = [...cur.fields]; const j = idx + dir; if (j < 0 || j >= fields.length) return cur;
      [fields[idx], fields[j]] = [fields[j], fields[idx]];
      return { ...cur, fields: fields.map((f, i) => ({ ...f, order: i })) };
    });
  }
  function onDragStart(idx: number) { setDragIndex(idx); }
  function onDragOver(e: React.DragEvent<HTMLDivElement>) { e.preventDefault(); }
  function onDrop(idx: number) {
    setForm((cur) => {
      if (dragIndex === null || dragIndex === idx) return cur;
      const fields = [...cur.fields];
      const [moved] = fields.splice(dragIndex, 1);
      fields.splice(idx, 0, moved);
      return { ...cur, fields: fields.map((f, i) => ({ ...f, order: i })) };
    });
    setDragIndex(null);
  }

  async function save(status?: string) {
    setBusy(status || "save"); setMessage("");
    try {
      const payload = {
        title: form.title, titleAr: form.titleAr || null, description: form.description || null, descriptionAr: form.descriptionAr || null,
        accessMode: form.accessMode, status: status || form.status,
        opensAt: form.opensAt || null, closesAt: form.closesAt || null, maxResponses: form.maxResponses || null, duplicatePolicy: form.duplicatePolicy,
        fields: form.fields.map((f, i) => ({ id: f.id, type: f.type, label: f.label, labelAr: f.labelAr || null, description: f.description || null, descriptionAr: f.descriptionAr || null, required: !!f.required, order: i, options: choiceTypes.has(f.type) ? (f.options || []).filter(Boolean) : undefined, validation: f.validation || undefined, isArchived: !!f.isArchived })),
        eventLinks: form.eventLinks.map((l) => ({ eventId: l.eventId, kind: l.kind || "GENERAL" })),
      };
      const res = await fetch(`/api/forms/${form.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveError"));
      setForm((cur) => ({ ...cur, ...data.form, fields: (data.form.fields as Field[]).map((f, i) => ({ ...f, options: Array.isArray(f.options) ? f.options : [], order: i })), eventLinks: (data.form.eventLinks as Array<{ event: { id: string; title: string; titleAr?: string | null }; kind: string }>).map((l) => ({ eventId: l.event.id, kind: l.kind, event: l.event })) }));
      setMessage(t("saved"));
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  async function duplicate() {
    setBusy("duplicate");
    try {
      const res = await fetch(`/api/forms/${form.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveError"));
      router.push(`/admin/forms/${data.form.id}`);
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : t("saveError")); }
    finally { setBusy(null); }
  }

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return `/forms/${form.publicSlug}`;
    return `${window.location.origin}/forms/${form.publicSlug}`;
  }, [form.publicSlug]);

  return (
    <div className="admin-form-builder">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button className="button button-primary" type="button" onClick={() => void save()} disabled={!!busy}>{busy === "save" ? t("saving") : t("saveDraft")}</button>
        <button className="button button-secondary" type="button" onClick={() => void save("PUBLISHED")} disabled={!!busy}>{t("publish")}</button>
        <button className="button button-secondary" type="button" onClick={() => void save("CLOSED")} disabled={!!busy}>{t("close")}</button>
        <button className="button button-secondary" type="button" onClick={() => void duplicate()} disabled={!!busy}>{t("duplicate")}</button>
        <button className="button button-secondary" type="button" onClick={() => setPreview((p) => !p)}>{preview ? t("exitPreview") : t("previewMode")}</button>
        <a className="button button-secondary" href={`/admin/forms/${form.id}/responses`}>{t("responsesTitle")}</a>
      </div>
      {message && <p role="status">{message}</p>}

      {!preview ? (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card" style={{ padding: 16 }}>
            <h2>{t("settings")}</h2>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
              <label>{t("formTitle")}<input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label>{t("formTitleAr")}<input className="input" dir="rtl" value={form.titleAr || ""} onChange={(e) => setForm({ ...form, titleAr: e.target.value })} /></label>
              <label>{t("access")}<select className="input" value={form.accessMode} onChange={(e) => setForm({ ...form, accessMode: e.target.value })}><option value="MEMBERS_ONLY">{t("MEMBERS_ONLY")}</option><option value="AUTHENTICATED_USERS">{t("AUTHENTICATED_USERS")}</option><option value="PUBLIC">{t("PUBLIC")}</option></select></label>
              <label>{t("duplicatePolicy")}<select className="input" value={form.duplicatePolicy} onChange={(e) => setForm({ ...form, duplicatePolicy: e.target.value })}><option value="ALLOW">{t("allowDuplicates")}</option><option value="ONE_PER_USER">{t("onePerUser")}</option><option value="ONE_PER_EMAIL">{t("onePerEmail")}</option><option value="ONE_PER_IP">{t("onePerIp")}</option></select></label>
              <label>{t("openAt")}<input className="input" type="datetime-local" value={form.opensAt ? form.opensAt.slice(0,16) : ""} onChange={(e) => setForm({ ...form, opensAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
              <label>{t("closeAt")}<input className="input" type="datetime-local" value={form.closesAt ? form.closesAt.slice(0,16) : ""} onChange={(e) => setForm({ ...form, closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
              <label>{t("maxResponses")}<input className="input" type="number" min={1} value={form.maxResponses ?? ""} onChange={(e) => setForm({ ...form, maxResponses: e.target.value ? Number(e.target.value) : null })} /></label>
              <label>{t("status")}<select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="DRAFT">{t("DRAFT")}</option><option value="PUBLISHED">{t("PUBLISHED")}</option><option value="CLOSED">{t("CLOSED")}</option><option value="ARCHIVED">{t("ARCHIVED")}</option></select></label>
            </div>
            <label style={{ display: "block", marginTop: 12 }}>{t("description")}<textarea className="input" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label style={{ display: "block", marginTop: 12 }}>{t("descriptionAr")}<textarea className="input" dir="rtl" value={form.descriptionAr || ""} onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })} /></label>
            <div style={{ marginTop: 12 }}>
              <strong>{t("publicLink")}</strong>: <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
              {form.status === "PUBLISHED" && form.accessMode === "PUBLIC" && (
                <div style={{ marginTop: 12 }}>
                  <QRCodeSVG value={shareUrl} size={140} includeMargin />
                </div>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <strong>{t("eventLinks")}</strong>
              {form.eventLinks.map((l, idx) => (
                <div key={`${l.eventId}-${idx}`} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <select className="input" value={l.eventId} onChange={(e) => { const next=[...form.eventLinks]; next[idx]={...next[idx], eventId: e.target.value}; setForm({...form, eventLinks: next}); }}>
                    <option value="">Select event</option>
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                  </select>
                  <select className="input" value={l.kind} onChange={(e) => { const next=[...form.eventLinks]; next[idx]={...next[idx], kind: e.target.value}; setForm({...form, eventLinks: next}); }}>
                    <option value="REGISTRATION">{t("REGISTRATION")}</option><option value="FEEDBACK">{t("FEEDBACK")}</option><option value="GENERAL">{t("GENERAL")}</option>
                  </select>
                  <button className="button button-secondary" type="button" onClick={() => setForm({ ...form, eventLinks: form.eventLinks.filter((_, i) => i !== idx) })}>{t("remove")}</button>
                </div>
              ))}
              <div style={{ marginTop: 8 }}><button className="button button-secondary" type="button" onClick={() => setForm({ ...form, eventLinks: [...form.eventLinks, { eventId: events[0]?.id || "", kind: "GENERAL" }] })}>{t("addEvent")}</button></div>
            </div>
          </section>

          <section className="card" style={{ padding: 16 }}>
            <h2>{t("questions")}</h2>
            {form.fields.map((field, idx) => (
              <div key={field.id || idx} draggable onDragStart={() => onDragStart(idx)} onDragOver={onDragOver} onDrop={() => onDrop(idx)} style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 12, marginBottom: 12, opacity: dragIndex === idx ? 0.6 : 1, cursor: "grab" }}>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                  <label>{t("question")}<input className="input" value={field.label} onChange={(e) => updateField(idx, { label: e.target.value })} /></label>
                  <label>{t("questionAr")}<input className="input" dir="rtl" value={field.labelAr || ""} onChange={(e) => updateField(idx, { labelAr: e.target.value })} /></label>
                  <label>{t("type")}<select className="input" value={field.type} onChange={(e) => { const type = e.target.value; updateField(idx, { type, options: choiceTypes.has(type) ? (field.options?.length ? field.options : ["Option 1"]) : [] }); }}>
                    {TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                  </select></label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!field.required} onChange={(e) => updateField(idx, { required: e.target.checked })} /> {t("required")}</label>
                </div>
                <label style={{ display: "block", marginTop: 8 }}>{t("description")}<input className="input" value={field.description || ""} onChange={(e) => updateField(idx, { description: e.target.value })} /></label>
                {choiceTypes.has(field.type) && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{t("options")}</strong>
                    {(field.options || []).map((opt, oi) => (
                      <div key={oi} style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <input className="input" value={opt} onChange={(e) => { const next=[...(field.options||[])]; next[oi]=e.target.value; updateField(idx, { options: next }); }} />
                        <button className="button button-secondary" type="button" onClick={() => updateField(idx, { options: (field.options || []).filter((_, i) => i !== oi) })}>{t("remove")}</button>
                      </div>
                    ))}
                    <button className="button button-secondary" type="button" style={{ marginTop: 6 }} onClick={() => updateField(idx, { options: [...(field.options || []), `Option ${(field.options?.length || 0) + 1}`] })}>{t("addOption")}</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button className="button button-secondary" type="button" onClick={() => moveField(idx, -1)}>↑</button>
                  <button className="button button-secondary" type="button" onClick={() => moveField(idx, 1)}>↓</button>
                  <button className="button button-secondary" type="button" onClick={() => updateField(idx, { isArchived: !field.isArchived, required: field.isArchived ? field.required : false })}>{field.isArchived ? "Restore" : "Archive"}</button>
                  <button className="button button-secondary" type="button" onClick={() => { if (field.id) { window.alert("Questions with existing responses cannot be deleted. Use Archive instead."); return; } removeField(idx); }}>{t("remove")}</button>
                </div>
                {field.isArchived && <p style={{ marginTop: 8 }}><small>Archived questions are hidden from respondents and cannot be required.</small></p>}
              </div>
            ))}
            <button className="button button-primary" type="button" onClick={addField}>{t("addQuestion")}</button>
          </section>
        </div>
      ) : (
        <section className="card" style={{ padding: 16 }}>
          <h2>{form.title || t("formTitle")}</h2>
          {form.description && <p>{form.description}</p>}
          {form.fields.filter((f) => !f.isArchived).map((f, i) => (
            <div key={f.id || i} style={{ marginBottom: 16 }}>
              <label><strong>{f.label || t("question")}{f.required ? " *" : ""}</strong></label>
              {f.description && <div><small>{f.description}</small></div>}
              {f.type === "SHORT_ANSWER" && <input className="input" disabled />}
              {f.type === "PARAGRAPH" && <textarea className="input" disabled />}
              {f.type === "EMAIL" && <input className="input" type="email" disabled />}
              {f.type === "PHONE" && <input className="input" disabled />}
              {f.type === "NUMBER" && <input className="input" type="number" disabled />}
              {f.type === "DATE" && <input className="input" type="date" disabled />}
              {f.type === "TIME" && <input className="input" type="time" disabled />}
              {f.type === "FILE_UPLOAD" && <input className="input" type="file" disabled />}
              {(f.type === "MULTIPLE_CHOICE" || f.type === "CHECKBOXES") && (f.options || []).map((o, oi) => <div key={oi}><label><input type={f.type === "CHECKBOXES" ? "checkbox" : "radio"} disabled /> {o}</label></div>)}
              {f.type === "DROPDOWN" && <select className="input" disabled><option>{t("selectOption")}</option>{(f.options||[]).map((o, oi)=><option key={oi}>{o}</option>)}</select>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
