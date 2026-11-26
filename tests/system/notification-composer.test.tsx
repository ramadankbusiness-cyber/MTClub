// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationComposer } from "@/components/notification-composer";

let locale = "en";
const toast = vi.fn();

vi.mock("next-intl", () => ({
  useLocale: () => locale,
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    const en: Record<string, string> = {
      composerTitle: "Compose an update",
      english: "English",
      arabic: "Arabic",
      titleEnglish: "Title (English)",
      titleArabic: "Title (Arabic)",
      typeLabel: "Type",
      messageEnglish: "Message (English)",
      messageArabic: "Message (Arabic)",
      link: "In-app link (optional)",
      audience: "Audience",
      everyone: "Everyone",
      byRole: "By role",
      byCommittee: "By committee",
      specificUsers: "Specific members",
      myCommittee: "My committee",
      role: "Role",
      committee: "Committee",
      recipients: "Recipients",
      schedule: "Schedule (leave blank to send now)",
      importantToggle: "Mark as important",
      preview: "Preview",
      hidePreview: "Hide preview",
      send: "Send notification",
      sending: "Sending…",
      scheduleButton: "Schedule notification",
      sent: `Notification sent to ${vars?.count ?? 0} recipients.`,
      scheduled: "Notification scheduled.",
      pushNotConfigured: " In-app delivery is active; push delivery is not configured.",
      sendError: "Could not send this notification. Please try again.",
      history: "Sent and scheduled",
      historyEmpty: "Your sent notification history will appear here.",
      deliveredRead: `Delivered to ${vars?.delivered ?? 0} · Read by ${vars?.read ?? 0}`,
      scheduledFor: `Scheduled for ${vars?.date ?? ""}`,
      title: "Title",
      message: "Message",
      important: "Important",
      previewTitle: "Your notification title",
      previewMessage: "Your message preview appears here.",
      mtcHeads: "MTC (club heads)",
      byPosition: "By position",
      position: "Position",
      "roleOptions.ADMIN": "Admin",
      "roleOptions.LEADER": "Leader",
      "roleOptions.MEMBER": "Member",
      "typeOptions.ANNOUNCEMENT": "Announcement",
      "typeOptions.NEW_EVENT": "New event",
      "typeOptions.EVENT_REMINDER": "Event reminder",
      "typeOptions.SESSION_OPENED": "Session opened",
      "typeOptions.ATTENDANCE_CONFIRMED": "Attendance confirmed",
      "typeOptions.ATTENDANCE_REJECTED": "Attendance rejected",
      "typeOptions.ABSENCE_WARNING": "Absence warning",
      "typeOptions.ACCOUNT_CREATED": "Account created",
      "typeOptions.PASSWORD_CHANGED": "Password changed",
      "typeOptions.ROLE_CHANGED": "Role changed",
      "typeOptions.EXCUSE_DECISION": "Excuse decision",
    };
    const ar: Record<string, string> = {
      composerTitle: "إنشاء تحديث",
      english: "English",
      arabic: "العربية",
      titleEnglish: "العنوان (بالإنجليزية)",
      titleArabic: "العنوان (بالعربية)",
      typeLabel: "النوع",
      messageEnglish: "الرسالة (بالإنجليزية)",
      messageArabic: "الرسالة (بالعربية)",
      link: "رابط داخل التطبيق (اختياري)",
      audience: "المستلمون",
      everyone: "الجميع",
      byRole: "حسب الدور",
      byCommittee: "حسب اللجنة",
      specificUsers: "أعضاء محددون",
      myCommittee: "لجنتي",
      role: "الدور",
      committee: "اللجنة",
      recipients: "المستلمون",
      schedule: "موعد الإرسال (اتركه فارغًا للإرسال الآن)",
      importantToggle: "تحديد كمهم",
      preview: "معاينة",
      hidePreview: "إخفاء المعاينة",
      send: "إرسال الإشعار",
      sending: "جاري الإرسال…",
      scheduleButton: "جدولة الإشعار",
      sent: `تم إرسال الإشعار إلى ${vars?.count ?? 0} مستلم.`,
      scheduled: "تمت جدولة الإشعار.",
      pushNotConfigured: " تم تفعيل الإشعارات داخل التطبيق، لكن الإشعارات الفورية غير مُعدّة.",
      sendError: "ما قدرناش نبعت الإشعار. حاول مرة تانية.",
      history: "المرسلة والمجدولة",
      historyEmpty: "هتظهر هنا الإشعارات اللي أرسلتها.",
      deliveredRead: `وصلت إلى ${vars?.delivered ?? 0} · قرأها ${vars?.read ?? 0}`,
      scheduledFor: `مجدول في ${vars?.date ?? ""}`,
      title: "العنوان",
      message: "الرسالة",
      important: "مهم",
      previewTitle: "عنوان الإشعار",
      previewMessage: "هتظهر معاينة رسالتك هنا.",
      mtcHeads: "MTC",
      byPosition: "حسب المنصب",
      position: "المنصب",
      "roleOptions.ADMIN": "مسؤول",
      "roleOptions.LEADER": "قائد",
      "roleOptions.MEMBER": "عضو",
      "typeOptions.ANNOUNCEMENT": "إعلان",
    };
    const dict = locale === "ar" ? ar : en;
    return dict[key] ?? en[key] ?? key;
  },
}));

vi.mock("@/components/app-toast-provider", () => ({ useAppToast: () => toast }));

vi.mock("@/components/committee-select", () => ({
  CommitteeSelect: ({ value, onChange, disabled }: any) => (
    <select aria-label="Committee select" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select</option>
      <option value="c1">Committee 1</option>
    </select>
  ),
}));

const historyItem = {
  id: "h1",
  title: "System update",
  message: "A very long notification message ".repeat(12) + "نص عربي طويل",
  audience: "EVERYONE" as const,
  sentAt: new Date().toISOString(),
  scheduledAt: null,
  important: true,
  deliveredCount: 12,
  readCount: 7,
};

describe("NotificationComposer", () => {
  beforeEach(() => {
    locale = "en";
    toast.mockReset();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/notifications?sent=true")) {
        return { ok: true, json: async () => ({ notifications: [historyItem] }) } as any;
      }
      if (String(url).endsWith("/api/notifications") && init?.method === "POST") {
        return { ok: true, json: async () => ({ notification: { sentAt: new Date().toISOString() }, recipientCount: 5, pushConfigured: false }) } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders admin composer and history in English", async () => {
    render(<NotificationComposer role="ADMIN" committees={[{ id: "c1", key: "tech", name: "Tech", nameAr: "تقنية" }]} users={[{ id: "u1", name: "User", email: "u@example.com" }]} />);
    expect(screen.getAllByText("Compose an update").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Title (English)")).toBeTruthy();
    expect(screen.getByLabelText("Message (English)")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("System update")).toBeTruthy());
    expect(screen.getByText(/Delivered to 12 · Read by 7/)).toBeTruthy();
    expect(screen.getAllByText("Important").length).toBeGreaterThan(0);
  });

  it("renders key labels in Arabic and supports RTL field direction", async () => {
    locale = "ar";
    render(<NotificationComposer role="ADMIN" committees={[{ id: "c1", key: "tech", name: "Tech", nameAr: "تقنية" }]} users={[]} />);
    expect(screen.getAllByText("إنشاء تحديث").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "العربية" }));
    const titleAr = screen.getByLabelText("العنوان (بالعربية)") as HTMLInputElement;
    expect(titleAr.getAttribute("dir")).toBe("rtl");
  });

  it("submits compose form and shows delivery feedback", async () => {
    render(<NotificationComposer role="ADMIN" committees={[]} users={[]} />);
    fireEvent.change(screen.getByLabelText("Title (English)"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Message (English)"), { target: { value: "World message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send notification" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/notifications", expect.objectContaining({ method: "POST" }));
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Notification sent to 5 recipients.");
      expect(screen.getByRole("status").textContent).toContain("In-app delivery is active; push delivery is not configured.");
    });
  });

  it("renders long history content with wrapping-safe attributes", async () => {
    render(<NotificationComposer role="ADMIN" committees={[]} users={[]} />);
    await waitFor(() => expect(screen.getByText("System update")).toBeTruthy());
    const message = screen.getByText(/نص عربي طويل/);
    expect(message.getAttribute("dir")).toBe("auto");
    expect(message.className).toContain("admin-notification-history-message");
  });
});
