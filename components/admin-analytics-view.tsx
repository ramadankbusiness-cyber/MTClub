"use client";
import { useEffect, useState } from "react";

type M = { id: string; name: string; committee: { name: string; nameAr: string } | null; totalEligible: number; present: number; late: number; absent: number; excused: number; attended: number; attendancePercentage: number; currentPoints: number; lastAttendanceDate: string | null };
type Data = { summary: { totalMembers: number; avgAttendance: number; avgPoints: number }; topAttendance: M[]; lowestAttendance: M[]; topPoints: M[]; frequentAbsence: M[]; frequentLate: M[]; members: M[] };

function Table({ title, rows, locale, showPoints = false }: { title: string; rows: M[]; locale: string; showPoints?: boolean }) {
  const ar = locale === "ar";
  return (
    <div className="team-edit-form" style={{ marginTop: "1rem" }}>
      <h3>{title}</h3>
      <div className="user-admin-list">
        {rows.map((m) => (
          <article className="user-admin-row" key={m.id}>
            <div className="user-admin-identity">
              <strong>{m.name}</strong>
              <span>{m.committee ? (ar ? m.committee.nameAr : m.committee.name) : (ar ? "بدون لجنة" : "No committee")}</span>
            </div>
            <div className="user-admin-status">
              <span>{ar ? "حضور" : "Att."}: {m.attended}/{m.totalEligible} ({m.attendancePercentage}%)</span>
              <span>{ar ? "غياب" : "Absent"}: {m.absent} · {ar ? "تأخير" : "Late"}: {m.late}</span>
              {showPoints && <span>{ar ? "النقاط" : "Points"}: {m.currentPoints}</span>}
            </div>
          </article>
        ))}
        {!rows.length && <p className="empty-note">{ar ? "لا توجد بيانات." : "No data."}</p>}
      </div>
    </div>
  );
}

export function AdminAnalyticsView({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => { void fetch("/api/admin/analytics", { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return <p>{ar ? "جارٍ التحميل..." : "Loading..."}</p>;
  return (
    <div>
      <div className="admin-form-grid" style={{ marginBottom: "1rem" }}>
        <div className="team-edit-form"><strong>{ar ? "الأعضاء" : "Members"}</strong><div>{data.summary.totalMembers}</div></div>
        <div className="team-edit-form"><strong>{ar ? "متوسط الحضور" : "Avg attendance"}</strong><div>{data.summary.avgAttendance}%</div></div>
        <div className="team-edit-form"><strong>{ar ? "متوسط النقاط" : "Avg points"}</strong><div>{data.summary.avgPoints}</div></div>
      </div>
      <Table title={ar ? "الأعلى حضورًا" : "Top attendance"} rows={data.topAttendance} locale={locale} showPoints />
      <Table title={ar ? "الأقل حضورًا" : "Lowest attendance"} rows={data.lowestAttendance} locale={locale} showPoints />
      <Table title={ar ? "الأعلى نقاط" : "Top points"} rows={data.topPoints} locale={locale} showPoints />
      <Table title={ar ? "تكرار الغياب" : "Frequent absences"} rows={data.frequentAbsence} locale={locale} />
      <Table title={ar ? "تكرار التأخير" : "Frequent late arrivals"} rows={data.frequentLate} locale={locale} />
    </div>
  );
}
