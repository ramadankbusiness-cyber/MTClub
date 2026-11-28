"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Item = { id:string; type:string; category:string; createdAt:string; actorName:string|null; actorEmail?:string|null; targetName?:string|null; targetEmail?:string|null; targetType?:string|null; targetId?:string|null; descriptionParams?:Record<string,string|number>; titleKey?:string; descriptionKey?:string };
const cats = ["ACCOUNT","PROFILE","EVENT","FORM","ATTENDANCE","POINTS","CERTIFICATE","SECURITY","ADMIN"] as const;

export function AdminActivityReview() {
  const t = useTranslations("site.adminPages.activity");
  const tc = useTranslations("site.activity.categories");
  const locale = useLocale();
  const [items, setItems] = useState<Item[]>([]);
  const [memberId, setMemberId] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string|null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (opts?: { reset?: boolean; cursor?: string|null }) => {
    const reset = opts?.reset ?? true;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError("");
    const params = new URLSearchParams();
    if (memberId.trim()) params.set("memberId", memberId.trim());
    if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", new Date(from).toISOString());
    if (to) { const d=new Date(to); d.setHours(23,59,59,999); params.set("to", d.toISOString()); }
    params.set("limit", "20");
    if (opts?.cursor) params.set("before", opts.cursor);
    try {
      const res = await fetch(`/api/admin/activity?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed");
      setItems((prev) => reset ? data.items : [...prev, ...data.items]);
      setHasMore(!!data.hasMore);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [memberId, category, q, from, to]);

  useEffect(() => { void load({ reset: true }); }, []);

  return (
    <div className="notification-center">
      <div className="notification-toolbar" style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", alignItems:"end" }}>
        <label>{t("memberId")}<input value={memberId} onChange={(e)=>setMemberId(e.target.value)} /></label>
        <label>{t("filter")}<select value={category} onChange={(e)=>setCategory(e.target.value)}><option value="">{t("all")}</option>{cats.map(c=><option key={c} value={c}>{tc(c)}</option>)}</select></label>
        <label>{t("from")}<input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} /></label>
        <label>{t("to")}<input type="date" value={to} onChange={(e)=>setTo(e.target.value)} /></label>
        <label style={{ gridColumn:"span 2" }}>{t("search")}<input value={q} onChange={(e)=>setQ(e.target.value)} /></label>
        <button type="button" className="button button-primary" onClick={()=>void load({ reset:true })}>{t("search")}</button>
      </div>
      {error && <div className="form-message" role="status"><span>{error}</span> <button type="button" className="button button-secondary" onClick={()=>void load({ reset:true })}>{t("retry")}</button></div>}
      {loading ? <p className="empty-note">{t("loading")}</p> : (
        <div className="notification-list">
          <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("when")}</th><th>{t("action")}</th><th>{t("category")}</th><th>{t("actor")}</th><th>{t("target")}</th></tr></thead><tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time></td>
                <td>{item.type}</td>
                <td>{tc(item.category)}</td>
                <td>{item.actorName || "system"}{item.actorEmail ? <div style={{opacity:.7,fontSize:".85em"}}>{item.actorEmail}</div> : null}</td>
                <td>{item.targetName || item.targetId || item.targetType || "—"}{item.targetEmail ? <div style={{opacity:.7,fontSize:".85em"}}>{item.targetEmail}</div> : null}</td>
              </tr>
            ))}
          </tbody></table></div>
          {!items.length && <div className="empty-events"><h2>{t("emptyTitle")}</h2><p>{t("empty")}</p></div>}
          {hasMore && <div style={{ marginTop:12 }}><button type="button" className="button button-secondary" disabled={loadingMore} onClick={()=>void load({ reset:false, cursor: nextCursor })}>{loadingMore ? t("loading") : t("loadMore")}</button></div>}
        </div>
      )}
    </div>
  );
}
