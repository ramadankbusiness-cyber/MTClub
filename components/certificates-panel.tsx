"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Cert = {
  id: string; certificateCode: string; title: string; titleAr?: string | null;
  issuerName: string; issuerNameAr?: string | null; issueDate: string;
  fileName: string; fileMime: string; fileSize: number; createdAt: string;
};

export function CertificatesPanel({ locale }: { locale: string }) {
  const t = useTranslations("site.certificates");
  const [items, setItems] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const res = await fetch("/api/certificates/mine", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed");
        if (alive) setItems(data?.certificates ?? []);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "Failed");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function openCert(id: string, mode: "view" | "print") {
    try {
      const res = await fetch(`/api/certificates/${id}/download`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed");
      }
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data?.url) {
          if (mode === "print") {
            const w = window.open(data.url, "_blank");
            if (w) w.addEventListener("load", () => { try { w.print(); } catch {} });
          } else {
            window.open(data.url, "_blank", "noopener,noreferrer");
          }
          return;
        }
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (mode === "print") {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed"; iframe.style.right = "0"; iframe.style.bottom = "0"; iframe.style.width = "0"; iframe.style.height = "0"; iframe.style.border = "0";
        iframe.src = url;
        iframe.onload = () => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch {} setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 2000); };
        document.body.appendChild(iframe);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  if (loading) return <p>{t("loading")}</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!items.length) return <p className="empty-note">{t("empty")}</p>;

  return (
    <div className="user-admin-list">
      {items.map((c) => {
        const title = locale === "ar" ? c.titleAr || c.title : c.title;
        const issuer = locale === "ar" ? c.issuerNameAr || c.issuerName : c.issuerName;
        return (
          <article className="user-admin-row" key={c.id}>
            <div className="user-admin-identity">
              <strong>{title}</strong>
              <span>{t("issuer")}: {issuer}</span>
              <span>{t("issueDate")}: {new Date(c.issueDate).toLocaleDateString(locale)}</span>
              <span>{t("certificateId")}: {c.certificateCode}</span>
            </div>
            <div className="user-admin-actions">
              <button type="button" className="button button-secondary" onClick={() => void openCert(c.id, "view")}>{t("view")}</button>
              <button type="button" className="button button-primary" onClick={() => void openCert(c.id, "print")}>{t("print")}</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
