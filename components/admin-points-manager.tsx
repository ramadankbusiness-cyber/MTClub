"use client";
import { useEffect, useState } from "react";
import { useAppToast } from "@/components/app-toast-provider";

type Member = {
  id: string; name: string; academicNumber: string | null; clubId: string | null;
  committee: { name: string; nameAr: string } | null;
  currentPoints: number; totalEarned: number; totalDeducted: number;
  attendance: { present: number; late: number; absent: number; excused: number; total: number; attended: number; percentage: number };
};
type Tx = {
  id: string; amount: number; reason: string; type: string; createdAt: string;
  event: { title: string; titleAr: string | null } | null;
  actor: { name: string } | null;
};

export function AdminPointsManager({ canManage, locale }: { canManage: boolean; locale: string }) {
  const ar = locale === "ar";
  const showToast = useAppToast();
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [history, setHistory] = useState<Tx[]>([]);
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadMembers(query = q) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/points?q=${encodeURIComponent(query)}&take=50`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMembers(data.members ?? []);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }
  async function loadHistory(userId: string) {
    try {
      const res = await fetch(`/api/admin/points/transactions?userId=${encodeURIComponent(userId)}&take=50`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setHistory(data.transactions ?? []);
      setBalance(data.balance ?? 0);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error"); }
  }
  useEffect(() => { void loadMembers(""); }, []);

  async function adjust(action: "ADD" | "DEDUCT") {
    if (!selected) return;
    const amt = Math.max(1, Math.trunc(Number(amount) || 0));
    const rsn = reason.trim();
    if (!rsn) { showToast(ar ? "السبب مطلوب." : "Reason is required."); return; }
    const label = action === "ADD" ? (ar ? "إضافة" : "Add") : (ar ? "خصم" : "Deduct");
    if (!window.confirm(ar ? `تأكيد ${label} ${amt} نقطة للعضو ${selected.name}؟` : `Confirm ${label.toLowerCase()} ${amt} points for ${selected.name}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: selected.id, amount: amt, reason: rsn, action }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      showToast(ar ? "تمت العملية بنجاح." : "Points updated.");
      setReason("");
      await loadMembers(q);
      await loadHistory(selected.id);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="admin-events">
      <section className="team-edit-form">
        <h2>{ar ? "بحث الأعضاء" : "Search members"}</h2>
        <div className="admin-form-grid">
          <label className="admin-form-wide">{ar ? "الاسم / الرقم الأكاديمي / معرف النادي" : "Name / academic number / club ID"}
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void loadMembers(q))} />
          </label>
        </div>
        <div className="form-actions"><button type="button" className="button button-primary" onClick={() => void loadMembers(q)} disabled={loading}>{loading ? "..." : (ar ? "بحث" : "Search")}</button></div>
        <div className="user-admin-list" style={{ marginTop: "1rem" }}>
          {members.map((m) => (
            <article className="user-admin-row" key={m.id}>
              <div className="user-admin-identity">
                <strong>{m.name}</strong>
                <span>{m.committee ? (ar ? m.committee.nameAr : m.committee.name) : (ar ? "بدون لجنة" : "No committee")} · {ar ? "الرصيد" : "Balance"}: {m.currentPoints}</span>
                <span>{ar ? "حضور" : "Attendance"}: {m.attendance.attended}/{m.attendance.total} ({m.attendance.percentage}%)</span>
              </div>
              <div className="user-admin-status"><span>+{m.totalEarned}</span><span>-{m.totalDeducted}</span></div>
              <div className="user-admin-actions">
                <button type="button" className="button button-secondary" onClick={() => { setSelected(m); void loadHistory(m.id); }}>{ar ? "إدارة" : "Manage"}</button>
              </div>
            </article>
          ))}
          {!members.length && !loading && <p className="empty-note">{ar ? "لا يوجد أعضاء." : "No members found."}</p>}
        </div>
      </section>

      {selected && (
        <section className="team-edit-form">
          <h2>{ar ? "نقاط العضو" : "Member points"}: {selected.name}</h2>
          <p>{ar ? "الرصيد الحالي" : "Current balance"}: <strong>{balance}</strong></p>
          {canManage && (
            <div className="admin-form-grid">
              <label>{ar ? "المبلغ (رقم موجب)" : "Amount (positive number)"}<input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.trunc(Number(e.target.value) || 1)))} /></label>
              <label className="admin-form-wide">{ar ? "السبب (مطلوب)" : "Reason (required)"}<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} /></label>
              <div className="form-actions">
                <button type="button" className="button button-primary" disabled={busy} onClick={() => void adjust("ADD")}>{ar ? "إضافة نقاط" : "Add points"}</button>
                <button type="button" className="button button-secondary danger-button" disabled={busy} onClick={() => void adjust("DEDUCT")}>{ar ? "خصم نقاط" : "Deduct points"}</button>
              </div>
            </div>
          )}
          <h3 style={{ marginTop: "1rem" }}>{ar ? "سجل المعاملات" : "Transaction history"}</h3>
          <div className="user-admin-list">
            {history.map((tx) => {
              const positive = tx.amount > 0;
              return (
                <article className="user-admin-row" key={tx.id}>
                  <div className="user-admin-identity">
                    <strong style={{ color: positive ? "var(--green, #16a34a)" : "var(--red, #dc2626)" }}>{positive ? `+${tx.amount}` : tx.amount}</strong>
                    <span>{tx.reason}</span>
                    <span>{new Date(tx.createdAt).toLocaleString(locale)} · {tx.type}</span>
                  </div>
                  <div className="user-admin-status">
                    <span>{positive ? (ar ? "إضافة" : "Added") : (ar ? "خصم" : "Deducted")}</span>
                    {tx.event && <span>{ar ? tx.event.titleAr || tx.event.title : tx.event.title}</span>}
                    {tx.actor && <span>{ar ? "بواسطة" : "By"}: {tx.actor.name}</span>}
                  </div>
                </article>
              );
            })}
            {!history.length && <p className="empty-note">{ar ? "لا توجد معاملات." : "No transactions yet."}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
