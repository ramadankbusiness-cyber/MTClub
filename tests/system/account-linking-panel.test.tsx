// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountLinkingPanel } from "@/components/account-linking-panel";

const mockUpdate = vi.fn(async () => null);
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next-auth/react", () => ({ useSession: () => ({ update: mockUpdate }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }) }));

const en: Record<string, string> = {
  googleTitle: "Google account", telegramTitle: "Telegram account", linked: "Linked", notLinked: "Not linked",
  linkGoogle: "Link Google", linkTelegram: "Generate Telegram link", missingBoth: "Google and Telegram are still required.",
  lockedNotice: "Website access is locked until both integrations are linked.", whyTitle: "Why this is required", whyBody: "Body",
  googleDesc: "Desc", telegramDesc: "Desc", refreshStatus: "Refresh status", continue: "Continue to dashboard",
  allLinked: "Both accounts are linked. You can continue to the website.", checking: "Checking…",
};
const ar: Record<string, string> = {
  googleTitle: "حساب Google", telegramTitle: "حساب Telegram", linked: "مرتبط", notLinked: "غير مرتبط",
  linkGoogle: "ربط Google", linkTelegram: "إنشاء رابط Telegram", missingBoth: "لا يزال ربط Google وTelegram مطلوبًا.",
  lockedNotice: "الوصول إلى الموقع مقفل حتى يتم ربط الحسابين.", whyTitle: "لماذا هذا مطلوب", whyBody: "نص",
  googleDesc: "وصف", telegramDesc: "وصف", refreshStatus: "تحديث الحالة", continue: "المتابعة إلى لوحة التحكم",
  allLinked: "تم ربط الحسابين. يمكنك متابعة استخدام الموقع.", checking: "جارٍ التحقق…",
};

let locale = "en";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => (locale === "ar" ? ar : en)[key] ?? key }));

describe("AccountLinkingPanel", () => {
  afterEach(() => cleanup());

  it("renders English linking screen with both missing", () => {
    locale = "en";
    render(<AccountLinkingPanel locale="en" initialStatus={{ googleLinked: false, telegramLinked: false, complete: false }} />);
    expect(screen.getByText("Google account")).toBeTruthy();
    expect(screen.getByText("Telegram account")).toBeTruthy();
    expect(screen.getByText("Google and Telegram are still required.")).toBeTruthy();
    expect(screen.getAllByText("Not linked").length).toBeGreaterThan(0);
  });

  it("renders Arabic linking screen", () => {
    locale = "ar";
    render(<AccountLinkingPanel locale="ar" initialStatus={{ googleLinked: false, telegramLinked: false, complete: false }} />);
    expect(screen.getByText("حساب Google")).toBeTruthy();
    expect(screen.getByText("حساب Telegram")).toBeTruthy();
    expect(screen.getByText("لا يزال ربط Google وTelegram مطلوبًا.")).toBeTruthy();
  });

  it("shows linked states", () => {
    locale = "en";
    render(<AccountLinkingPanel locale="en" initialStatus={{ googleLinked: true, googleEmail: "a@b.com", telegramLinked: true, telegramUsername: "tg", complete: true }} />);
    expect(screen.getAllByText("Linked").length).toBeGreaterThan(0);
  });
});
