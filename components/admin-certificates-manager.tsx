"use client";

import { useEffect, useRef, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";

type Member = { id: string; name: string; email?: string };
type Cert = { id: string; certificateCode: string; title: string; titleAr?: string | null; issuerName: string; issueDate: string; user: { id: string; name: string; email: string }; issuedBy?: { id: string; name: string } | null };

export function AdminCertificatesManager({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const showToast = useAppToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ userId: "", title: "", titleAr: "", issuerName: "MT Club", issuerNameAr: "نادي MT", issueDate: new Date().toISOString().slice(0,10) });
  const [file, setFile] = useState<File | null>(null);
  const pendingIssuanceRef = useRef<{ key: string; payload: string } | null>(null);

  async function loadMembers() {
    try {
      const res = await fetch("/api/admin/points?q=&take=100", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok) setMembers((data?.members ?? []).map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })));
    } catch {}
  }
  async function loadCerts() {
    try {
      const res = await fetch(`/api/admin/certificates?q=${encodeURIComponent(q)}&take=50`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok) setCerts(data?.certificates ?? []);
    } catch {}
  }
  useEffect(() => { void loadMembers(); void loadCerts(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.userId || !form.title.trim() || !form.issuerName.trim() || !form.issueDate || !file) {
      showToast(ar ? "أكمل جميع الحقول المطلوبة." : "Complete all required fields."); return;
    }
    const payload = JSON.stringify({ userId: form.userId, title: form.title.trim(), titleAr: form.titleAr.trim(), issuerName: form.issuerName.trim(), issuerNameAr: form.issuerNameAr.trim(), issueDate: form.issueDate, fileName: file.name, fileSize: file.size, fileType: file.type });
    if (pendingIssuanceRef.current?.payload !== payload) {
      pendingIssuanceRef.current = { key: crypto.randomUUID(), payload };
    }
    const idempotencyKey = pendingIssuanceRef.current.key;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("userId", form.userId);
      fd.set("title", form.title.trim());
      if (form.titleAr.trim()) fd.set("titleAr", form.titleAr.trim());
      fd.set("issuerName", form.issuerName.trim());
      if (form.issuerNameAr.trim()) fd.set("issuerNameAr", form.issuerNameAr.trim());
      fd.set("issueDate", form.issueDate);
      fd.set("idempotencyKey", idempotencyKey);
      fd.set("file", file);
      const res = await fetch("/api/admin/certificates", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed");
      pendingIssuanceRef.current = null;
      showToast(data?.idempotent ? (ar ? "تمت معالجة الطلب مسبقًا." : "Request already processed.") : (ar ? "تم إصدار الشهادة." : "Certificate issued."));
      setForm((f) => ({ ...f, title: "", titleAr: "", userId: "" }));
      setFile(null);
      await loadCerts();
    } catch (err: unknown) {
      // keep idempotency key for retry of same logical issuance
      showToast(err instanceof Error ? err.message : "Error");
    } finally { setBusy(false); }
  }

  async function openCert(id: string) {
    const res = await fetch(`/api/certificates/${id}/download`, { cache: "no-store" });
    if (!res.ok) { showToast(ar ? "تعذر فتح الشهادة." : "Could not open certificate."); return; }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) { const d = await res.json(); if (d?.url) window.open(d.url, "_blank", "noopener,noreferrer"); return; }
    const blob = await res.blob(); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  return (
    <div className="admin-events">
      <section className="team-edit-form">
        <h2>{ar ? "إصدار شهادة" : "Issue certificate"}</h2>
        <form onSubmit={submit} className="admin-form-grid">
          <label>{ar ? "العضو" : "Member"}
            <select value={form.userId} onChange={(e)=>setForm({...form, userId:e.target.value})} required>
              <option value="">{ar ? "اختر عضوًا" : "Select member"}</option>
              {members.map((m)=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>{ar ? "تاريخ الإصدار" : "Issue date"}<input type="date" value={form.issueDate} onChange={(e)=>setForm({...form, issueDate:e.target.value})} required /></label>
          <label>{ar ? "العنوان (EN)" : "Title (EN)"}<input value={form.title} onChange={(e)=>setForm({...form, title:e.target.value})} required /></label>
          <label>{ar ? "العنوان (AR)" : "Title (AR)"}<input value={form.titleAr} onChange={(e)=>setForm({...form, titleAr:e.target.value})} /></label>
          <label>{ar ? "الجهة (EN)" : "Issuer (EN)"}<input value={form.issuerName} onChange={(e)=>setForm({...form, issuerName:e.target.value})} required /></label>
          <label>{ar ? "الجهة (AR)" : "Issuer (AR)"}<input value={form.issuerNameAr} onChange={(e)=>setForm({...form, issuerNameAr:e.target.value})} /></label>
          <label className="admin-form-wide">{ar ? "ملف الشهادة (PDF/صورة)" : "Certificate file (PDF/image)"}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e)=>setFile(e.target.files?.[0] ?? null)} required /></label>
          <div className="form-actions admin-form-wide"><button type="submit" className="button button-primary" disabled={busy}>{busy ? "..." : (ar ? "إصدار" : "Issue")}</button></div>
        </form>
      </section>

      <section className="team-edit-form">
        <h2>{ar ? "الشهادات الصادرة" : "Issued certificates"}</h2>
        <div className="admin-form-grid">
          <label className="admin-form-wide">{ar ? "بحث" : "Search"}<input value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&(e.preventDefault(),void loadCerts())} /></label>
        </div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={()=>void loadCerts()}>{ar ? "تحديث" : "Refresh"}</button></div>
        <div className="user-admin-list" style={{marginTop:"1rem"}}>
          {certs.map((c)=>(
            <article className="user-admin-row" key={c.id}>
              <div className="user-admin-identity">
                <strong>{c.title}</strong>
                <span>{c.user.name} · {c.certificateCode}</span>
                <span>{new Date(c.issueDate).toLocaleDateString(locale)}</span>
              </div>
              <div className="user-admin-actions"><button type="button" className="button button-secondary" onClick={()=>void openCert(c.id)}>{ar ? "عرض" : "View"}</button></div>
            </article>
          ))}
          {!certs.length && <p className="empty-note">{ar ? "لا توجد شهادات." : "No certificates."}</p>}
        </div>
      </section>
    </div>
  );
}
