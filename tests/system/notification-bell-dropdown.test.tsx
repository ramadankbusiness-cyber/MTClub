// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationBell } from "@/components/notification-bell";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", name: "Test" } } }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, onClick, ...rest }: any) => <a href={href} onClick={onClick} {...rest}>{children}</a>,
  usePathname: () => "/en",
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    const map: Record<string, string> = { bell: "Notifications", unread: `${vars?.count ?? 0} unread`, recent: "Recent notifications", viewAll: "View all", caughtUp: "You are all caught up.", markRead: "Mark read" };
    return map[key] ?? key;
  },
}));
vi.mock("@/lib/use-dismiss", () => ({ useDismiss: () => {} }));

const notifications = [{ id: "r1", readAt: null, notification: { id: "n1", title: "First", message: "Hello", link: null, important: false, createdAt: new Date().toISOString() } }];
class MockEventSource { addEventListener() {} close() {} }

describe("NotificationBell dropdown", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource as any);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/notifications?unread=true")) return { ok: true, json: async () => ({ unreadCount: 1, notifications }) } as any;
      if (String(url).includes("/api/notifications/") && (init as any)?.method === "PATCH") return { ok: true, json: async () => ({ ok: true }) } as any;
      return { ok: false, json: async () => ({}) } as any;
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("opens, shows recent notifications, and supports mark-read interaction", async () => {
    const { container } = render(<NotificationBell />);
    await waitFor(() => expect(screen.getByLabelText("Notifications, 1 unread")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Notifications, 1 unread"));
    expect(screen.getByRole("region", { name: "Recent notifications" })).toBeTruthy();
    expect(screen.getByText("View all")).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
    const pop = container.querySelector(".notification-popover") as HTMLElement;
    expect(pop.style.insetInlineEnd).toBe("auto");
    expect(pop.style.insetInlineStart).toContain("px");
    fireEvent.click(screen.getByRole("button", { name: "Mark read: First" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/notifications/n1", expect.objectContaining({ method: "PATCH" })));
  });
});
