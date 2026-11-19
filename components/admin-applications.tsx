"use client";

import { useEffect, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";
import { useLocale, useTranslations } from "next-intl";
import { CommitteeSelect } from "@/components/committee-select";

type Application = {
  id: number | string;
  name: string;
  email: string;
  academicNumber?: string | null;
  academic_number?: string | null;
  committees: string[];
  message: string;
  created_at: string;
};

export function AdminApplications() {
  const t = useTranslations("site.adminPages.applications");
  const locale = useLocale();
  const showToast = useAppToast();
  const [applications, setApplications] = useState<Application[]>([]);
  const [committee, setCommittee] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadApplications() {
      setLoading(true);
      setError("");
      try {
        const query = committee ? `?committee=${encodeURIComponent(committee)}` : "";
        const response = await fetch(`/api/admin/applications${query}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error("load-failed");
        setApplications(result.applications);
      } catch {
        if (!controller.signal.aborted) {
          const errorMessage = t("loadError");
          setError(errorMessage);
          showToast(errorMessage);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadApplications();
    return () => controller.abort();
  }, [committee, showToast]);

  return (
    <div className="admin-applications">
      <div className="application-filter">
        <label htmlFor="application-committee-filter">{t("filter")}</label>
        <CommitteeSelect
          id="application-committee-filter"
          valueField="name"
          value={committee}
          onChange={(v) => setCommittee(Array.isArray(v) ? "" : (v || ""))}
          mode="single"
          showAll={true}
          allLabel={t("all")}
        />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="empty-note" role="status">{t("loading")}</p> : (
        <div className="application-list">
          {applications.map((application) => {
            const academicNumber = application.academicNumber ?? application.academic_number ?? "";
            return (
              <article className="application-card" key={application.id}>
                <div className="application-card-heading">
                  <div>
                    <h2>{application.name}</h2>
                    <a href={`mailto:${application.email}`}>{application.email}</a>
                    {academicNumber && <p className="application-academic-number"><strong>{t("academicNumber")}:</strong> {academicNumber}</p>}
                  </div>
                  <time dateTime={application.created_at}>{new Date(application.created_at).toLocaleString(locale)}</time>
                </div>
                <ul className="join-committee-pills application-committee-pills" aria-label={t("selected")}>
                  {application.committees.map((item) => <li key={item}><span>{item}</span></li>)}
                </ul>
                <p>{application.message}</p>
              </article>
            );
          })}
          {!applications.length && !error && <p className="empty-note">{t("empty")}</p>}
        </div>
      )}
    </div>
  );
}
