// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QrScannerView } from "@/components/qr-scanner";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "en",
}));

describe("QrScannerView fullscreen", () => {
  afterEach(() => { cleanup(); document.body.style.overflow = ""; document.body.style.overscrollBehavior = ""; });

  it("toggles fullscreen and restores body scroll on exit and unmount", async () => {
    const { container, unmount, getByLabelText } = render(
      <QrScannerView active={false} onDecode={() => {}} labels={{ fullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen" }} />
    );
    const shell = container.querySelector(".qr-scanner-shell") as HTMLElement;
    expect(shell.getAttribute("data-fullscreen")).toBe("false");

    fireEvent.click(getByLabelText("Fullscreen"));
    await waitFor(() => expect(shell.classList.contains("is-fullscreen")).toBe(true));
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(shell.classList.contains("is-fullscreen")).toBe(false));
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(getByLabelText("Fullscreen"));
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
