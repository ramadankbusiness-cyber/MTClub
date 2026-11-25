// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChangePasswordForm } from "@/components/change-password-form";

const replace = vi.fn();
const refresh = vi.fn();
const update = vi.fn(async () => undefined);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ update }),
}));

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows live password requirement indicators", () => {
    render(<ChangePasswordForm />);
    const newPassword = screen.getByLabelText("new") as HTMLInputElement;
    expect(screen.getByText("reqLength")).toBeTruthy();
    fireEvent.change(newPassword, { target: { value: "Abcdefghijk1" } }); // 12 chars, upper, lower, number
    const metItems = document.querySelectorAll(".password-requirement.is-met");
    expect(metItems.length).toBe(4);
  });

  it("submits password change and redirects on success", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true, sessionTransition: "tok" }) });
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText("current"), { target: { value: "CurrentPass123!" } });
    fireEvent.change(screen.getByLabelText("new"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/auth/change-password", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sessionTransition: "tok" }));
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("shows elegant error on failure and prevents stuck busy state", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: "Current password is incorrect." }) });
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText("current"), { target: { value: "wrong" } });
    fireEvent.change(screen.getByLabelText("new"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Current password is incorrect."));
    expect(screen.getByRole("button", { name: "submit" })).toBeTruthy();
  });
});
