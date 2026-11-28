// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

let mockStatus = "authenticated";
let mockSession: any = { user: { id: "u1" } };
const fetchMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: mockSession, status: mockStatus }),
}));
vi.mock("@/components/site-provider", () => ({
  useSite: () => ({ text: { nav: { points: "Points", pointsBalanceAria: "Your points balance" } } }),
}));
vi.mock("lucide-react", () => ({ Star: (props: any) => <svg data-testid="star" {...props} /> }));

import { PointsIndicator, POINTS_UPDATED_EVENT } from "@/components/points-indicator";

function flush() { return act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe("PointsIndicator", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mockStatus = "authenticated";
    mockSession = { user: { id: "u1" } };
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // default no reduced motion
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders initial balance without animation", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 50 }) });
    await act(async () => { root.render(<PointsIndicator />); });
    await flush();
    const el = container.querySelector(".points-indicator");
    expect(el).toBeTruthy();
    expect(container.textContent).toContain("50");
    expect(el?.className).not.toContain("points-indicator--up");
    expect(el?.className).not.toContain("points-indicator--down");
  });

  it("animates on increase and decrease only on actual change", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 10 }) });
    await act(async () => { root.render(<PointsIndicator />); });
    await flush();
    expect(container.textContent).toContain("10");

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 15 }) });
    await act(async () => { window.dispatchEvent(new CustomEvent(POINTS_UPDATED_EVENT, { detail: {} })); });
    await flush();
    expect(container.textContent).toContain("15");
    expect(container.querySelector(".points-indicator")?.className).toContain("points-indicator--up");

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 12 }) });
    await act(async () => { window.dispatchEvent(new CustomEvent(POINTS_UPDATED_EVENT, { detail: {} })); });
    await flush();
    expect(container.textContent).toContain("12");
    expect(container.querySelector(".points-indicator")?.className).toContain("points-indicator--down");

    // same balance - no animation class change to up/down due to same value; should not animate
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 12 }) });
    await act(async () => { window.dispatchEvent(new CustomEvent(POINTS_UPDATED_EVENT, { detail: {} })); });
    await flush();
    expect(container.textContent).toContain("12");
  });

  it("does not replay animation on remount (refresh/login)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ balance: 30 }) });
    await act(async () => { root.render(<PointsIndicator />); });
    await flush();
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => { root.render(<PointsIndicator />); });
    await flush();
    const el = container.querySelector(".points-indicator");
    expect(el?.className).not.toContain("points-indicator--up");
    expect(el?.className).not.toContain("points-indicator--down");
  });

  it("respects prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 10 }) });
    await act(async () => { root.render(<PointsIndicator />); });
    await flush();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 20 }) });
    await act(async () => { window.dispatchEvent(new CustomEvent(POINTS_UPDATED_EVENT, { detail: {} })); });
    await flush();
    const el = container.querySelector(".points-indicator");
    expect(el?.className).not.toContain("points-indicator--up");
  });
});
