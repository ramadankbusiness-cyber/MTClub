"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type InterestedPerson = { id: string; name: string; email: string; readinessAt?: string };
type RegistrationRow = { id: string; name: string; email: string | null; type: "MEMBER" | "EXTERNAL"; submittedAt: string; submissionPublicId: string };
type AttendedRow = { id: string; name: string; email: string; checkedInAt: string | null; status: string; source: "QR" | "MANUAL" | "EXCUSE" | "UNKNOWN" };

type DashboardData = {
  event: { id: string; title: string; titleAr?: string | null; startsAt: string };
  counts: {
    interested: number;
    totalRegistrations: number;
    memberRegistrations: number;
    externalRegistrations: number;
    uniqueRegisteredPeople: number;
    uniqueRegisteredPeopleIsPartial: boolean;
    externalWithoutStableIdentity: number;
    qrVerifiedAttended: number;
    manualAttended: number;
    unknownOriginAttended: number;
    attendedTotalUnique: number;
    interestedAndRegisteredMembers: number;
  };
  rates: {
    attendancePercentage: number;
    attendanceNumerator: string;
    attendanceDenominator: string;
    attendanceDenominatorValue: number;
    conversionInterestedToRegistered: number;
    conversionNumerator: string;
    conversionDenominator: string;
    conversionDenominatorValue: number;
  };
  lists: { interested: InterestedPerson[]; registrations: RegistrationRow[]; attended: AttendedRow[] };
};

type Tab = "interested" | "registrations" | "attended";

export function EventDashboard({ eventId, locale }: { eventId: string; locale: string }) {
  const t = useTranslations("site.admin.eventDashboard");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("interested");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const res = await fetch(`/api/events/${eventId}/dashboard`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Failed to load");
        if (alive) setData(json);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [eventId]);

  const filtered = useMemo(() => {
    if (!data) return [] as Array<InterestedPerson | RegistrationRow | AttendedRow>;
    const needle = q.trim().toLowerCase();
    const source = data.lists[tab] as Array<InterestedPerson | RegistrationRow | AttendedRow>;
    if (!needle) return source;
    return source.filter((p) => [p.name, p.email, p.id].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [data, tab, q]);

  if (loading) return <p>{t("loading")}</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return null;

  const sourceLabel = (s: AttendedRow["source"]) => s === "QR" ? t("qr") : s === "MANUAL" ? t("manual") : s === "EXCUSE" ? t("excused") : t("unknown");

  return (
    <div className="event-dashboard" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="button button-secondary" href="/admin/events">{t("backToEvents")}</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <StatCard label={t("interested")} value={data.counts.interested} />
        <StatCard label={t("totalRegistrations")} value={data.counts.totalRegistrations} />
        <StatCard label={t("memberRegistrations")} value={data.counts.memberRegistrations} />
        <StatCard label={t("externalRegistrations")} value={data.counts.externalRegistrations} />
        <StatCard label={t("uniqueRegisteredPeople")} value={data.counts.uniqueRegisteredPeople} note={data.counts.uniqueRegisteredPeopleIsPartial ? t("uniqueRegisteredPeoplePartial") : undefined} />
        <StatCard label={t("qrVerifiedAttended")} value={data.counts.qrVerifiedAttended} />
        <StatCard label={t("manualAttended")} value={data.counts.manualAttended} />
        <StatCard label={t("unknownOriginAttended")} value={data.counts.unknownOriginAttended} />
        <StatCard label={t("attendanceRate")} value={`${data.rates.attendancePercentage}%`} note={t("registeredDenom")} />
        <StatCard label={t("conversionRate")} value={`${data.rates.conversionInterestedToRegistered}%`} note={t("interestedDenom")} />
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button className={`button ${tab === "interested" ? "button-primary" : "button-secondary"}`} type="button" onClick={() => setTab("interested")}>{t("interested")} ({data.counts.interested})</button>
          <button className={`button ${tab === "registrations" ? "button-primary" : "button-secondary"}`} type="button" onClick={() => setTab("registrations")}>{t("registrations")} ({data.counts.totalRegistrations})</button>
          <button className={`button ${tab === "attended" ? "button-primary" : "button-secondary"}`} type="button" onClick={() => setTab("attended")}>{t("attendedTotal")} ({data.counts.attendedTotalUnique})</button>
          <input className="input" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("email")}</th>
                <th>{tab === "registrations" ? t("registrationType") : tab === "attended" ? t("attendanceSource") : t("status")}</th>
                <th>{tab === "interested" ? t("readinessAt") : tab === "registrations" ? t("submittedAt") : t("checkedInAt")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4}>{t("empty")}</td></tr>
              ) : filtered.map((p) => {
                if (tab === "interested") {
                  const r = p as InterestedPerson;
                  return <tr key={r.id}><td>{r.name}</td><td>{r.email}</td><td>{t("interested")}</td><td>{r.readinessAt ? new Date(r.readinessAt).toLocaleString(locale) : "-"}</td></tr>;
                }
                if (tab === "registrations") {
                  const r = p as RegistrationRow;
                  return <tr key={r.submissionPublicId}><td>{r.name}</td><td>{r.email || "-"}</td><td>{r.type === "MEMBER" ? t("member") : t("external")}</td><td>{r.submittedAt ? new Date(r.submittedAt).toLocaleString(locale) : "-"}</td></tr>;
                }
                const a = p as AttendedRow;
                return <tr key={a.id}><td>{a.name}</td><td>{a.email}</td><td>{sourceLabel(a.source)}</td><td>{a.checkedInAt ? new Date(a.checkedInAt).toLocaleString(locale) : "-"}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
      {note ? <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}
