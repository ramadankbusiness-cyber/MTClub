"use client";
import { useEffect, useState } from "react";

type Tx = { id: string; amount: number; reason: string; type: string; createdAt: string; event: { title: string; titleAr: string | null } | null };
type Data = { balance: number; totalEarned: number; totalDeducted: number; eventPoints: number; manualAdded: number; manualDeducted: number; transactions: Tx[] };

export function MemberPointsCard({ locale }: { locale: string }) {
  const ar = locale === "ar";
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => { void fetch("/api/profile/points", { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data) return null;
  return (
    <section className="team-edit-form" style={{ marginTop: "1.5rem" }}>
      <h2>{ar ? "نقاطي" : "My points"}</h2>
      <div className="admin-form-grid">
        <div><strong>{ar ? "الرصيد الحالي" : "Current balance"}</strong><div>{data.balance}</div></div>
        <div><strong>{ar ? "إجمالي المكتسب" : "Total earned"}</strong><div>+{data.totalEarned}</div></div>
        <div><strong>{ar ? "إجمالي المخصوم" : "Total deducted"}</strong><div>-{data.totalDeducted}</div></div>
        <div><strong>{ar ? "نقاط الفعاليات" : "Event points"}</strong><div>{data.eventPoints}</div></div>
        <div><strong>{ar ? "إضافات يدوية" : "Manual added"}</strong><div>+{data.manualAdded}</div></div>
        <div><strong>{ar ? "خصومات يدوية" : "Manual deducted"}</strong><div>-{data.manualDeducted}</div></div>
      </div>
      <h3 style={{ marginTop: "1rem" }}>{ar ? "آخر المعاملات" : "Recent transactions"}</h3>
      <div className="user-admin-list">
        {data.transactions.map((tx) => {
          const positive = tx.amount > 0;
          return (
            <article className="user-admin-row" key={tx.id}>
              <div className="user-admin-identity">
                <strong style={{ color: positive ? "var(--green,#16a34a)" : "var(--red,#dc2626)" }}>{positive ? `+${tx.amount}` : tx.amount}</strong>
                <span>{tx.reason}</span>
                <span>{new Date(tx.createdAt).toLocaleString(locale)}{tx.event ? ` · ${ar ? tx.event.titleAr || tx.event.title : tx.event.title}` : ""}</span>
              </div>
              <div className="user-admin-status"><span>{positive ? (ar ? "إضافة" : "Added") : (ar ? "خصم" : "Deducted")}</span><span>{tx.type}</span></div>
            </article>
          );
        })}
        {!data.transactions.length && <p className="empty-note">{ar ? "لا توجد معاملات بعد." : "No transactions yet."}</p>}
      </div>
    </section>
  );
}
