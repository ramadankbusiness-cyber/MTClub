// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminUserManager } from "@/components/admin-user-manager";

const showToast = vi.fn();

const en: Record<string, string> = {
  temporaryPassword: "Temporary Password",
  temporarySecurityNotice: "This is a temporary password. The account holder must change it on their first sign-in.",
  copyPassword: "Copy Password",
  copied: "Copied!",
  copyFailed: "Could not copy password. Please copy it manually.",
  closeDialog: "Close",
  accounts: "Accounts",
  resetPassword: "Reset password",
  resetDone: "Password reset. Share this temporary password securely.",
  resetError: "Could not reset the password.",
  createTitle: "Create an account",
  name: "Full name",
  email: "Email",
  role: "Role",
  member: "Member",
  leader: "Leader",
  admin: "Admin",
  committee: "Committee",
  chooseCommittee: "Choose committee",
  creating: "Creating…",
  create: "Create account",
  empty: "No accounts have been created yet.",
  noCommittee: "No committee",
  active: "Active",
  inactive: "Inactive",
  passwordRequired: " · Password change required",
  roleFor: "Role for {name}",
  committeeFor: "Committee for {name}",
  saveRole: "Save role",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
  delete: "Delete",
  deleteConfirm: "Permanently delete the account for {name}? This cannot be undone.",
  updateError: "Could not update this account.",
  roleUpdated: "Role updated. The account must choose a new password at next sign-in.",
  deleteError: "Could not delete the account.",
  position: "Position",
  isMtc: "Part of MTC / Club heads",
};

const ar: Record<string, string> = {
  ...en,
  temporaryPassword: "كلمة المرور المؤقتة",
  temporarySecurityNotice: "هذه كلمة مرور مؤقتة. يجب على صاحب الحساب تغييرها عند أول تسجيل دخول.",
  copyPassword: "نسخ كلمة المرور",
  copied: "تم النسخ!",
  copyFailed: "تعذر نسخ كلمة المرور. يرجى نسخها يدويًا.",
  closeDialog: "إغلاق",
};

let currentLocale = "en";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    const dict = currentLocale === "ar" ? ar : en;
    const val = dict[key] ?? key;
    if (!vars) return val;
    return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  },
  useLocale: () => currentLocale,
}));

vi.mock("@/components/app-toast-provider", () => ({
  useAppToast: () => showToast,
}));

vi.mock("@/components/committee-select", () => ({
  CommitteeSelect: () => <div data-testid="committee-select" />,
}));

vi.mock("@/data/committees", () => ({
  getPositionLabel: (p: string) => p,
}));

const user = {
  id: "u1",
  name: "Test User",
  email: "test@example.com",
  role: "MEMBER" as const,
  position: "LEADER" as const,
  isMTC: false,
  committeeId: null,
  committee: null,
  isActive: true,
  mustChangePassword: true,
};

describe("AdminUserManager temporary password card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLocale = "en";
    global.fetch = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => cleanup());

  async function openResetDialog() {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ temporaryPassword: "TempPass123!@#" }) });
    render(<AdminUserManager initialUsers={[user]} committees={[]} userRole="ADMIN" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Temporary Password" })).toBeTruthy());
  }

  it("displays the generated temporary password in a prominent card", async () => {
    await openResetDialog();
    expect(screen.getByText("TempPass123!@#")).toBeTruthy();
    expect(screen.getByText("This is a temporary password. The account holder must change it on their first sign-in.")).toBeTruthy();
  });

  it("copies password and shows Copied! feedback", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openResetDialog();
    const copyBtn = screen.getByRole("button", { name: /Copy Password/i });
    fireEvent.click(copyBtn);
    await waitFor(() => expect((navigator.clipboard.writeText as any)).toHaveBeenCalledWith("TempPass123!@#"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copied!/i })).toBeTruthy());
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(screen.getByRole("button", { name: /Copy Password/i })).toBeTruthy());
    vi.useRealTimers();
  });

  it("handles clipboard failure gracefully with localized error", async () => {
    (navigator.clipboard.writeText as any).mockRejectedValueOnce(new Error("denied"));
    await openResetDialog();
    fireEvent.click(screen.getByRole("button", { name: /Copy Password/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not copy password"));
  });

  it("renders Arabic localized copy", async () => {
    currentLocale = "ar";
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ temporaryPassword: "TempPass123!@#" }) });
    render(<AdminUserManager initialUsers={[user]} committees={[]} userRole="ADMIN" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "كلمة المرور المؤقتة" })).toBeTruthy());
    expect(screen.getByText("نسخ كلمة المرور")).toBeTruthy();
    expect(screen.getByText("هذه كلمة مرور مؤقتة. يجب على صاحب الحساب تغييرها عند أول تسجيل دخول.")).toBeTruthy();
  });
});
