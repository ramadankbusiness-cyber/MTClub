"use client";
import { useEffect, useState } from "react";

type Row = { rank: number; id: string; name: string; committee: { name: string; nameAr: string } | null; totalPoints: number; attendanceCount: number; attendancePercentage: number };
const medal = (rank: number) => rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;

export function LeaderboardView({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { void fetch("/api/leaderboard?take=50", { cache: "no-store" }).then((r) => r.json()).then((d) => setRows(d.leaderboard ?? [])).catch(() => {}); }, []);
  return (
    <div className="team-edit-form">
      <div className="user-admin-list">
        {rows.map((r) => (
          <article className="user-admin-row" key={r.id}>
            <div className="user-admin-identity">
              <strong>{medal(r.rank)} {r.name}</strong>
              <span>{r.committee ? (ar ? r.committee.nameAr : r.committee.name) : (ar ? "بدون لجنة" : "No committee")}</span>
            </div>
            <div className="user-admin-status">
              <span>{ar ? "النقاط" : "Points"}: {r.totalPoints}</span>
              <span>{ar ? "الحضور" : "Attendance"}: {r.attendanceCount} ({r.attendancePercentage}%)</span>
            </div>
          </article>
        ))}
        {!rows.length && <p className="empty-note">{ar ? "لا توجد بيانات بعد." : "No data yet."}</p>}
      </div>
    </div>
  );
}
