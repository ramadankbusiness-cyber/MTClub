"use client";

import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PushSettings } from "@/components/push-settings";
import { useLocale, useTranslations } from "next-intl";

const types = ["ANNOUNCEMENT", "NEW_EVENT", "EVENT_REMINDER", "SESSION_OPENED", "ATTENDANCE_CONFIRMED", "ATTENDANCE_REJECTED", "ABSENCE_WARNING", "ACCOUNT_CREATED", "PASSWORD_CHANGED", "ROLE_CHANGED", "EXCUSE_DECISION", "POINTS_ADDED", "POINTS_DEDUCTED", "BIRTHDAY"] as const;
type InboxItem = {
  id: string;
  readAt: string | null;
  eventReadinessInterested?: boolean;
  notification: { id: string; title: string; message: string; link: string | null; type: string; important: boolean; createdAt: string; eventId?: string | null };
};
type Preference = { type: string; inApp: boolean; push: boolean };

function dayBucket(iso: string, t: (k: string) => string) {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfToday.getDate() - 1);
  if (d >= startOfToday) return t("today");
  if (d >= startOfYesterday) return t("yesterday");
  return t("earlier");
}

export function NotificationCenter() {
  const t = useTranslations("site.notifications");
  const locale = useLocale();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [readyBusy, setReadyBusy] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async (opts?: { reset?: boolean; filter?: string; q?: string; cursor?: string | null }) => {
    const reset = opts?.reset ?? true;
    const filter = opts?.filter ?? type;
    const q = (opts?.q ?? search).trim();
    const cursor = opts?.cursor ?? null;
    if (reset) setLoading(true); else setLoadingMore(true);
    setMessage("");
    const params = new URLSearchParams();
    if (filter) params.set("type", filter);
    if (q) params.set("q", q);
    params.set("limit", "20");
    if (cursor) params.set("before", cursor);
    try {
      const response = await fetch(`/api/notifications?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || t("loadError"));
      setItems((prev) => reset ? result.notifications : [...prev, ...result.notifications]);
      setUnreadCount(result.unreadCount ?? 0);
      setHasMore(!!result.hasMore);
      setNextCursor(result.nextCursor ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("loadError"));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [type, search, t]);

  useEffect(() => { void load({ reset: true, filter: "", q: "" }); }, []);
  useEffect(() => {
    fetch("/api/notifications/preferences").then(async (response) => {
      if (response.ok) setPreferences((await response.json()).preferences);
    });
  }, []);

  async function act(item: InboxItem, action: "read" | "unread" | "delete") {
    setMessage("");
    const response = await fetch(`/api/notifications/${item.notification.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) { setMessage(t("updateError")); return; }
    if (action === "delete") {
      setItems((prev) => prev.filter((r) => r.id !== item.id));
      setUnreadCount((c) => item.readAt ? c : Math.max(0, c - 1));
    } else {
      const nextReadAt = action === "read" ? new Date().toISOString() : null;
      setItems((prev) => prev.map((r) => r.id === item.id ? { ...r, readAt: nextReadAt } : r));
      setUnreadCount((c) => action === "read" ? (!item.readAt ? Math.max(0, c - 1) : c) : (item.readAt ? c + 1 : c));
    }
  }

  async function toggleReadiness(item: InboxItem) {
    const eventId = item.notification.eventId;
    if (!eventId) return;
    const nextAction = item.eventReadinessInterested ? "withdraw" : "interested";
    setReadyBusy(eventId);
    setMessage("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/readiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: nextAction }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || t("readyError"));
      setItems((current) => current.map((row) => row.notification.eventId === eventId ? { ...row, eventReadinessInterested: !!result?.interested } : row));
      setMessage(result?.interested ? t("readySaved") : t("readyWithdrawn"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("readyError"));
    } finally { setReadyBusy(""); }
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (!response.ok) { setMessage(t("readError")); return; }
    setItems((prev) => prev.map((r) => ({ ...r, readAt: r.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function updatePreference(preference: Preference, key: "inApp" | "push") {
    const next = { ...preference, [key]: !preference[key] };
    const response = await fetch("/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!response.ok) { setMessage(t("preferenceError")); return; }
    const result = await response.json().catch(() => null);
    const saved = result?.preference ? { ...next, inApp: !!result.preference.inApp, push: !!result.preference.push } : next;
    setPreferences((current) => current.map((item) => item.type === saved.type ? saved : item));
  }

  const grouped = useMemo(() => {
    const buckets: Array<{ label: string; items: InboxItem[] }> = [];
    for (const item of items) {
      const label = dayBucket(item.notification.createdAt, t);
      const last = buckets[buckets.length - 1];
      if (last && last.label === label) last.items.push(item);
      else buckets.push({ label, items: [item] });
    }
    return buckets;
  }, [items, t]);

  const typeLabel = (value: string) => types.includes(value as typeof types[number]) ? t(`typeOptions.${value as typeof types[number]}`) : value;

  return (
    <div className="notification-center">
      <div className="notification-toolbar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ minWidth: 180 }}>{t("filter")}
          <select value={type} onChange={(event) => { const v = event.target.value; setType(v); void load({ reset: true, filter: v, q: search }); }}>
            <option value="">{t("all")}</option>
            {types.map((item) => <option value={item} key={item}>{t(`typeOptions.${item}`)}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>{t("search")}
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setSearch(query); void load({ reset: true, filter: type, q: query }); } }} placeholder={t("search")} />
        </label>
        <button className="button button-secondary" type="button" onClick={() => { setSearch(query); void load({ reset: true, filter: type, q: query }); }}>{t("search")}</button>
        <button className="button button-secondary" type="button" disabled={!unreadCount} onClick={() => void markAllRead()}>{t("markAllRead")}</button>
      </div>

      {message && <div className="form-message" role="status" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{message}</span><button type="button" className="button button-secondary" onClick={() => void load({ reset: true })}>{t("retry")}</button></div>}

      {loading ? <p className="empty-note">{t("loading")}</p> : (
        <div className="notification-list">
          {grouped.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 style={{ margin: "16px 0 8px", opacity: 0.8 }}>{group.label}</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {group.items.map((item) => (
                  <article className={`notification-item${item.readAt ? " is-read" : ""}`} key={item.id}>
                    <div className="notification-item-copy">
                      <div className="notification-item-title">{item.notification.important && <span className="important-tag">{t("important")}</span>}<span className="notification-type">{typeLabel(item.notification.type)}</span></div>
                      <h2>{item.notification.title}</h2><p>{item.notification.message}</p>
                      <time dateTime={item.notification.createdAt}>{new Date(item.notification.createdAt).toLocaleString(locale)}</time>
                      {item.notification.link && <Link href={item.notification.link}>{t("open")}</Link>}
                    </div>
                    <div className="notification-item-actions">
                      {item.notification.eventId && (item.notification.type === "NEW_EVENT" || item.notification.type === "EVENT_REMINDER") && (
                        <button type="button" disabled={readyBusy === item.notification.eventId} onClick={() => void toggleReadiness(item)}>
                          {readyBusy === item.notification.eventId ? t("readyLoading") : item.eventReadinessInterested ? t("withdrawReady") : t("ready")}
                        </button>
                      )}
                      <button type="button" onClick={() => void act(item, item.readAt ? "unread" : "read")}>{item.readAt ? t("markUnread") : t("markRead")}</button>
                      <button type="button" onClick={() => void act(item, "delete")}>{t("delete")}</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!items.length && <div className="empty-events"><h2>{t("emptyTitle")}</h2><p>{t("empty")}</p></div>}
          {hasMore && <div style={{ marginTop: 12 }}><button type="button" className="button button-secondary" disabled={loadingMore} onClick={() => void load({ reset: false, cursor: nextCursor })}>{loadingMore ? t("loading") : t("loadMore")}</button></div>}
        </div>
      )}

      <section className="notification-preferences">
        <h2>{t("preferences")}</h2>
        <p>{t("preferencesHint")}</p>
        <div className="preference-table-wrap"><table className="preference-table"><thead><tr><th>{t("type")}</th><th>{t("inApp")}</th><th>{t("push")}</th></tr></thead><tbody>
          {preferences.map((preference) => {
            const tl = typeLabel(preference.type);
            const mandatory = ["ACCOUNT_CREATED", "PASSWORD_CHANGED", "ROLE_CHANGED"].includes(preference.type);
            return <tr key={preference.type}><th scope="row">{tl}</th><td><input aria-label={t("inAppAria", { type: tl })} type="checkbox" checked={mandatory ? true : preference.inApp} disabled={mandatory} onChange={() => void updatePreference(preference, "inApp")} /></td><td><input aria-label={t("pushAria", { type: tl })} type="checkbox" checked={preference.push} onChange={() => void updatePreference(preference, "push")} /></td></tr>;
          })}
        </tbody></table></div>
        <PushSettings />
      </section>
    </div>
  );
}
