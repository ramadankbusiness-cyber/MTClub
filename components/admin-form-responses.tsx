"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Field = { id: string; label: string; labelAr?: string | null; type: string; options?: unknown };
type Submission = { id: string; publicId: string; submittedAt: string; respondentName?: string | null; respondentEmail?: string | null; answers: { fieldId: string; value: unknown; fileName?: string | null; hasFile?: boolean }[] };

export function AdminFormResponses({ formId }: { formId: string }) {
  const t = useTranslations("site.admin.forms");
  const [fields, setFields] = useState<Field[]>([]);
  const [items, setItems] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"summary"|"individual">("summary");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/forms/${formId}/responses?take=100${q ? `&q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (res.ok) { setFields(data.fields || []); setItems(data.submissions || []); setTotal(data.total || 0); }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [formId]);

  const summaries = useMemo(() => {
    return fields.filter((f) => ["MULTIPLE_CHOICE","DROPDOWN","CHECKBOXES"].includes(f.type)).map((f) => {
      const counts: Record<string, number> = {};
      const opts = Array.isArray(f.options) ? f.options as string[] : [];
      opts.forEach((o) => counts[o] = 0);
      for (const s of items) {
        const a = s.answers.find((x) => x.fieldId === f.id);
        const v = a?.value;
        if (Array.isArray(v)) v.forEach((x) => { const k = String(x); counts[k] = (counts[k] || 0) + 1; });
        else if (typeof v === "string" && v) counts[v] = (counts[v] || 0) + 1;
      }
      return { field: f, counts };
    });
  }, [fields, items]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <a className="button button-secondary" href={`/api/forms/${formId}/responses/export?format=csv`}>{t("exportCsv")}</a>
        <a className="button button-secondary" href={`/api/forms/${formId}/responses/export?format=xlsx`}>{t("exportXlsx")}</a>
        <input className="input" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="button button-secondary" type="button" onClick={() => void load()}>{t("search")}</button>
        <button className="button button-secondary" type="button" onClick={() => setTab("summary")}>{t("responseSummary")}</button>
        <button className="button button-secondary" type="button" onClick={() => setTab("individual")}>{t("individual")}</button>
      </div>
      <p>{t("totalResponses")}: {total}</p>
      {loading ? <p>...</p> : tab === "summary" ? (
        <div style={{ display: "grid", gap: 12 }}>
          {summaries.length === 0 ? <p>{t("noResponses")}</p> : summaries.map((s) => (
            <div key={s.field.id} className="card" style={{ padding: 12 }}>
              <strong>{s.field.label}</strong>
              <ul>{Object.entries(s.counts).map(([k,v]) => <li key={k}>{k}: {v}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead><tr><th>{t("submittedAt")}</th><th>{t("respondent")}</th>{fields.map((f) => <th key={f.id}>{f.label}</th>)}</tr></thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={2 + fields.length}>{t("noResponses")}</td></tr> : items.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.submittedAt).toLocaleString()}</td>
                  <td>{s.respondentName || s.respondentEmail || t("anonymous")}</td>
                  {fields.map((f) => {
                    const a = s.answers.find((x) => x.fieldId === f.id);
                    const v = a?.value;
                    const text = Array.isArray(v) ? v.join(", ") : (v && typeof v === "object" ? (((v as {fileName?:string}).fileName) || "[file]") : (v ?? ""));
                    return <td key={f.id}>
                      {String(text)}
                      {a?.hasFile && <div><a href={`/api/forms/${formId}/responses/${s.id}/file?fieldId=${encodeURIComponent(f.id)}`} target="_blank" rel="noreferrer">Download</a></div>}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
