"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { Bell } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDismiss } from "@/lib/use-dismiss";

type InboxItem = {
  id: string;
  readAt: string | null;
  notification: { id: string; title: string; message: string; link: string | null; important: boolean; createdAt: string };
};

export function NotificationBell() {
  const t = useTranslations("site.notifications");
  const { data: session } = useSession();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss({ enabled: open, onDismiss: close, refs: [wrapRef] });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function refresh() {
    const response = await fetch("/api/notifications?unread=true", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    setUnreadCount(result.unreadCount);
    setItems(result.notifications.slice(0, 5));
  }

  useEffect(() => {
    if (!session?.user) return;
    void refresh();
    const source = new EventSource("/api/notifications/stream");
    source.addEventListener("refresh", (event) => {
      const data = (event as MessageEvent<string>).data;
      if (data) setUnreadCount(JSON.parse(data).unreadCount ?? 0);
      void refresh();
    });
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { source.close(); window.clearInterval(interval); };
  }, [session?.user]);

  async function markRead(id: string) {
    const response = await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    });
    if (response.ok) await refresh();
  }

  if (!session?.user) return null;
  return (
    <div className="notification-bell-wrap" ref={wrapRef}>
      <button className="notification-button" type="button" aria-label={`${t("bell")}${unreadCount ? `, ${t("unread", { count: unreadCount })}` : ""}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void refresh(); }}>
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && <div className="notification-popover" role="region" aria-label={t("recent")}>
        <div className="notification-popover-heading"><strong>{t("bell")}</strong><Link href="/notifications" onClick={() => setOpen(false)}>{t("viewAll")}</Link></div>
        {items.length ? items.map((item) => (
          <div className="notification-preview" key={item.id}>
            <div><strong>{item.notification.important && <span aria-label="Important">★ </span>}{item.notification.title}</strong><p>{item.notification.message}</p></div>
            <button type="button" aria-label={`${t("markRead")}: ${item.notification.title}`} onClick={() => void markRead(item.notification.id)}>{t("markRead")}</button>
          </div>
        )) : <p className="empty-note">{t("caughtUp")}</p>}
      </div>}
    </div>
  );
}
