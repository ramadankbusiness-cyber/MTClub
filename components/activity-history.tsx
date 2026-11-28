"use client";

import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Item = { id: string; type: string; category: string; createdAt: string; titleKey: string; descriptionKey: string; descriptionParams?: Record<string, string|number>; href: string|null; actor: "SELF"|"ADMIN"|"SYSTEM"; actorName: string|null };
const cats = ["ACCOUNT","PROFILE","EVENT","FORM","ATTENDANCE","POINTS","CERTIFICATE","SECURITY","ADMIN"] as const;

function dayBucket(iso: string, t: (k: string) => string) {
  const d = new Date(iso); const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yday = new Date(today); yday.setDate(today.getDate()-1);
  if (d >= today) return t("today"); if (d >= yday) return t("yesterday"); return t("earlier");
}

export function ActivityHistory() {
  const t = useTranslations("site.activity");
  const locale = useLocale();
  const [items, setItems] = useState<Item[]>([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string|null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (opts?: { reset?: boolean; cursor?: string|null; category?: string; q?: string }) => {
    const reset = opts?.reset ?? true;
    const cat = opts?.category ?? category;
    const q = (opts?.q ?? search).trim();
    const cursor = opts?.cursor ?? null;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError("");
    const params = new URLSearchParams();
    if (cat) params.set("category", cat);
    if (q) params.set("q", q);
    params.set("limit", "20");
    if (cursor) params.set("before", cursor);
    try {
      const res = await fetch(`/api/activity?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed");
      setItems((prev) => reset ? data.items : [...prev, ...data.items]);
      setHasMore(!!data.hasMore);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [category, search]);

  useEffect(() => { void load({ reset: true, category: "", q: "" }); }, []);

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: Item[] }> = [];
    for (const item of items) {
      const label = dayBucket(item.createdAt, t);
      const last = out[out.length-1];
      if (last && last.label === label) last.items.push(item); else out.push({ label, items: [item] });
    }
    return out;
  }, [items, t]);

  const fmt = (item: Item) => {
    const params = item.descriptionParams || {};
    const descKey = item.descriptionKey;
    try { return t(descKey, params as Record<string, string | number>); } catch { return descKey; }
  };
  const title = (item: Item) => { try { return t(item.titleKey); } catch { return item.type; } };
  const actorLabel = (item: Item) => item.actor === "SELF" ? t("bySelf") : item.actor === "ADMIN" ? (item.actorName ? `${t("byAdmin")}: ${item.actorName}` : t("byAdmin")) : t("bySystem");

  return (
    <div className="notification-center">
      <div className="notification-toolbar" style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"end" }}>
        <label style={{ minWidth: 180 }}>{t("filter")}
          <select value={category} onChange={(e)=>{ const v=e.target.value; setCategory(v); void load({ reset:true, category:v, q:search }); }}>
            <option value="">{t("all")}</option>
            {cats.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </select>
        </label>
        <label style={{ flex:1, minWidth:220 }}>{t("search")}
          <input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); setSearch(query); void load({ reset:true, category, q:query }); } }} />
        </label>
        <button type="button" className="button button-secondary" onClick={()=>{ setSearch(query); void load({ reset:true, category, q:query }); }}>{t("search")}</button>
      </div>
      {error && <div className="form-message" role="status"><span>{error}</span> <button type="button" className="button button-secondary" onClick={()=>void load({ reset:true })}>{t("retry")}</button></div>}
      {loading ? <p className="empty-note">{t("loading")}</p> : (
        <div className="notification-list">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 style={{ margin:"16px 0 8px", opacity:.8 }}>{g.label}</h3>
              <div style={{ display:"grid", gap:10 }}>
                {g.items.map((item) => (
                  <article className="notification-item is-read" key={item.id}>
                    <div className="notification-item-copy">
                      <div className="notification-item-title"><span className="notification-type">{t(`categories.${item.category}`)}</span></div>
                      <h2>{title(item)}</h2>
                      <p>{fmt(item)}</p>
                      <p style={{ opacity:.75, fontSize:".9em" }}>{actorLabel(item)}</p>
                      <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time>
                      {item.href && <Link href={item.href}>{t("open")}</Link>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!items.length && <div className="empty-events"><h2>{t("emptyTitle")}</h2><p>{t("empty")}</p></div>}
          {hasMore && <div style={{ marginTop:12 }}><button type="button" className="button button-secondary" disabled={loadingMore} onClick={()=>void load({ reset:false, cursor: nextCursor })}>{loadingMore ? t("loading") : t("loadMore")}</button></div>}
        </div>
      )}
    </div>
  );
}
