// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SplashScreen } from "@/components/splash-screen";

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

describe("SplashScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows once on initial load and hides after transition", () => {
    render(<SplashScreen />);
    expect(screen.getByRole("status", { name: "MT Club" })).toBeTruthy();
    expect(window.sessionStorage.getItem("mtc-splash-seen")).toBe("1");

    act(() => { vi.advanceTimersByTime(1200); });
    expect(screen.queryByRole("status", { name: "MT Club" })).toBeNull();
  });

  it("does not show again in the same session", () => {
    window.sessionStorage.setItem("mtc-splash-seen", "1");
    render(<SplashScreen />);
    expect(screen.queryByRole("status", { name: "MT Club" })).toBeNull();
  });
});
