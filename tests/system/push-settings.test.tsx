// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PushSettings } from "@/components/push-settings";

const toast = vi.fn();
vi.mock("@/components/app-toast-provider", () => ({ useAppToast: () => toast }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

function setupBrowser(overrides?: { permission?: NotificationPermission; sw?: any; pushManager?: boolean; vapid?: string; secure?: boolean }) {
  const permission = overrides?.permission ?? "default";
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: overrides?.secure ?? true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission, requestPermission: vi.fn(async () => "granted") } });
  const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://example.com/ep", keys: { p256dh: "p", auth: "a" } }) }));
  const getSubscription = vi.fn(async () => null);
  const registration = { pushManager: { subscribe, getSubscription } };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: overrides?.sw ?? { register: vi.fn(async () => registration), ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) } });
  (window as any).PushManager = overrides?.pushManager === false ? undefined : function PushManager() {};
  if (overrides?.pushManager === false) delete (window as any).PushManager;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = overrides?.vapid ?? "BAAAAA";
  return { subscribe, getSubscription, registration };
}

describe("PushSettings", () => {
  beforeEach(() => {
    toast.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ subscriptionId: "s1" }) })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("handles unsupported browser", async () => {
    setupBrowser({ pushManager: false });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    delete (window as any).PushManager;
    render(<PushSettings />);
    expect(screen.getByRole("button", { name: "pushEnable" })).toHaveProperty("disabled", true);
  });

  it("handles granted permission and persists subscription", async () => {
    const { subscribe } = setupBrowser({ permission: "granted" });
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("pushEnabled").length).toBeGreaterThan(0));
  });

  it("handles denied permission with settings guidance", async () => {
    setupBrowser({ permission: "denied" });
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(screen.getAllByText("pushDeniedHelp").length).toBeGreaterThan(0));
  });

  it("shows config message when VAPID key is missing", async () => {
    setupBrowser({ vapid: "" });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "";
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(screen.getByText("pushNotConfiguredClient")).toBeTruthy());
  });

  it("handles service worker unavailable/failure", async () => {
    const rejectedReady = Promise.reject(new Error("sw")); rejectedReady.catch(() => {});
    setupBrowser({ sw: { register: vi.fn(async () => { throw new Error("sw fail"); }), ready: rejectedReady, getRegistration: vi.fn(async () => null) } });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: vi.fn(async () => "granted") } });
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(screen.getByText("pushServiceWorkerError")).toBeTruthy());
  });

  it("handles subscription creation failure", async () => {
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => { throw new Error("sub fail"); }) } };
    setupBrowser({ sw: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) } });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: vi.fn(async () => "granted") } });
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(screen.getByText("pushSubscribeFailed")).toBeTruthy());
  });

  it("handles subscription persistence failure", async () => {
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://example.com/ep", keys: { p256dh: "p", auth: "a" } }) })) } };
    setupBrowser({ sw: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) } });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: vi.fn(async () => "granted") } });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "bad" }) })));
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(screen.getByText("pushPersistFailed")).toBeTruthy());
  });

  it("handles permission default/dismissed", async () => {
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => ({ toJSON: () => ({}) })) } };
    setupBrowser({ sw: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) } });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: vi.fn(async () => "default") } });
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(screen.getByText("pushPermissionDismissed")).toBeTruthy());
  });

  it("requests permission on explicit click when permission is default", async () => {
    const requestPermission = vi.fn(async () => "granted");
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://example.com/ep", keys: { p256dh: "p", auth: "a" } }) })) } };
    setupBrowser({ sw: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) } });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission } });
    render(<PushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "pushEnable" }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  });

  it("handles service worker unavailable", async () => {
    setupBrowser({ permission: "granted" });
    // @ts-expect-error - simulate missing Service Worker API
    delete navigator.serviceWorker;
    render(<PushSettings />);
    expect(screen.getByRole("button", { name: "pushEnable" })).toHaveProperty("disabled", true);
  });
});
