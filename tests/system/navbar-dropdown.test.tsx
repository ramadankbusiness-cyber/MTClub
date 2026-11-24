// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Navbar } from "@/components/navbar";

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Admin", role: "ADMIN", image: null } } }),
  signOut: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, onClick, ...rest }: any) => <a href={href} onClick={onClick} {...rest}>{children}</a>,
  usePathname: () => "/",
}));

vi.mock("@/components/site-provider", () => ({
  useSite: () => ({
    language: "en",
    toggleLanguage: vi.fn(),
    toggleTheme: vi.fn(),
    text: {
      nav: {
        homeLabel: "Home", home: "Home", about: "About", events: "Events", team: "Team", join: "Join",
        switchTo: "Switch", language: "EN", theme: "Theme", account: "Account", dashboard: "Dashboard",
        attendance: "Attendance", attendanceReports: "Reports", pointsManagement: "Points", memberAnalytics: "Analytics",
        leaderboard: "Leaderboard", excuses: "Excuses", profile: "Profile", notifications: "Notifications",
        sendNotifications: "Send", applications: "Applications", manageAccounts: "Users", manageEvents: "Manage Events",
        zones: "Zones", audit: "Audit", logout: "Logout", login: "Login", joinUs: "Join Us", menu: "Menu"
      }
    }
  }),
}));

vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => <div data-testid="bell" /> }));

afterEach(() => cleanup());

describe("navbar dropdown behavior", () => {
  it("does not close account menu when clicking empty/non-interactive area inside menu, closes on Escape/toggle/nav item", () => {
    render(<Navbar />);
    const toggle = screen.getByLabelText("Account");

    fireEvent.click(toggle);
    const menu = document.querySelector(".account-menu") as HTMLElement;
    expect(menu).toBeTruthy();

    // click empty/non-interactive area inside menu (the container itself)
    fireEvent.click(menu);
    expect(document.querySelector(".account-menu")).toBeTruthy();

    // click name (non-interactive)
    fireEvent.click(screen.getByText("Admin"));
    expect(document.querySelector(".account-menu")).toBeTruthy();

    // Escape closes
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".account-menu")).toBeFalsy();

    // toggle opens and closes
    fireEvent.click(toggle);
    expect(document.querySelector(".account-menu")).toBeTruthy();
    fireEvent.click(toggle);
    expect(document.querySelector(".account-menu")).toBeFalsy();

    // selecting nav item closes
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText("Dashboard"));
    expect(document.querySelector(".account-menu")).toBeFalsy();
  });

  it("mobile menu closes on Escape and toggle, not on empty/non-interactive nav container click", () => {
    render(<Navbar />);
    const menuBtn = screen.getByLabelText("Menu");
    fireEvent.click(menuBtn);
    const nav = document.getElementById("site-navigation") as HTMLElement;
    expect(nav.className).toContain("is-open");

    fireEvent.click(nav); // clicking container background should not close
    expect(nav.className).toContain("is-open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(nav.className).not.toContain("is-open");

    fireEvent.click(menuBtn);
    expect(nav.className).toContain("is-open");
    fireEvent.click(menuBtn);
    expect(nav.className).not.toContain("is-open");
  });
});
