import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  writeAuditLog: vi.fn(async () => ({})),
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    notificationRecipient: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    notificationPreference: { findMany: vi.fn(), upsert: vi.fn() },
    notification: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    eventReadiness: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    pointTransaction: { findMany: vi.fn() },
    formSubmission: { findMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
    certificate: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb({ notification: { create: mocks.prisma.notification.create }, notificationRecipient: { updateMany: vi.fn(), createMany: vi.fn() } })),
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/notification-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notification-delivery")>();
  return { ...actual, dispatchPushNotification: vi.fn(async () => ({ configured: true, sent: 1 })), insertNotificationRecipients: vi.fn(async () => {}) };
});
vi.mock("@/lib/committees", () => ({ isClubCommitteeId: vi.fn(async () => true) }));

import { GET as getNotifications, POST as postNotification } from "@/app/api/notifications/route";
import { PATCH as patchNotification } from "@/app/api/notifications/[id]/route";
import { POST as readAll } from "@/app/api/notifications/read-all/route";
import { GET as getActivity } from "@/app/api/activity/route";
import { GET as getAdminActivity } from "@/app/api/admin/activity/route";

function authed(user: any) {
  mocks.auth.mockResolvedValue({ user: { id: user.id } });
  mocks.prisma.user.findUnique.mockResolvedValue(user);
}
const baseUser = { id: "u1", role: "MEMBER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t", preferredLanguage: "en" };
const adminUser = { ...baseUser, id: "admin1", role: "ADMIN", committeeId: null };

describe("Phase 5 notifications and activity", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("member sees only own notifications and unread count is derived", async () => {
    authed(baseUser);
    mocks.prisma.notificationRecipient.findMany
      .mockResolvedValueOnce([{ id: "r1", readAt: null, createdAt: new Date(), notification: { id: "n1", title: "T", titleAr: null, message: "M", messageAr: null, link: "/events/1", type: "ANNOUNCEMENT", important: false, createdAt: new Date(), eventId: null } }])
      .mockResolvedValueOnce([{ notification: { type: "ANNOUNCEMENT" }, user: { notificationPreferences: [] } }]); // countUnreadForUser
    mocks.prisma.notificationPreference.findMany.mockResolvedValueOnce([]); // hidden
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    const res = await getNotifications(new Request("http://x/api/notifications"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toHaveLength(1);
    expect(body.unreadCount).toBe(1);
    expect(mocks.prisma.notificationRecipient.findMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("mark one as read is scoped and repeated request is safe", async () => {
    authed(baseUser);
    mocks.prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 1 });
    const ctx = { params: Promise.resolve({ id: "n1" }) } as any;
    const r1 = await patchNotification(new Request("http://x/api/notifications/n1", { method: "PATCH", body: JSON.stringify({ action: "read" }) }), ctx);
    expect(r1.status).toBe(200);
    mocks.prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 0 });
    const r2 = await patchNotification(new Request("http://x/api/notifications/n1", { method: "PATCH", body: JSON.stringify({ action: "read" }) }), ctx);
    expect(r2.status).toBe(404);
  });

  it("mark all read updates only current user delivered unread", async () => {
    authed(baseUser);
    mocks.prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 3 });
    const res = await readAll();
    expect(res.status).toBe(200);
    expect(mocks.prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({ where: { userId: "u1", readAt: null, deliveredAt: { not: null } }, data: { readAt: expect.any(Date) } });
  });

  it("notification preferences enforce mandatory in-app security types", async () => {
    authed(baseUser);
    mocks.prisma.notificationPreference.upsert.mockResolvedValue({ userId: "u1", type: "PASSWORD_CHANGED", inApp: true, push: false });
    const { PATCH } = await import("@/app/api/notifications/preferences/route");
    const res = await PATCH(new Request("http://x/api/notifications/preferences", { method: "PATCH", body: JSON.stringify({ type: "PASSWORD_CHANGED", inApp: false, push: false }) }));
    expect(res.status).toBe(200);
    expect(mocks.prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ inApp: true, push: false }) }));
  });

  it("member sees only own activity history", async () => {
    authed(baseUser);
    mocks.prisma.pointTransaction.findMany.mockResolvedValue([]);
    mocks.prisma.formSubmission.findMany.mockResolvedValue([]);
    mocks.prisma.attendanceRecord.findMany.mockResolvedValue([]);
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    mocks.prisma.certificate.findMany.mockResolvedValue([]);
    mocks.prisma.auditLog.findMany.mockResolvedValue([]);
    const res = await getActivity(new Request("http://x/api/activity?limit=20"));
    expect(res.status).toBe(200);
    // verify queries scoped to u1
    expect(mocks.prisma.pointTransaction.findMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("unauthorized member cannot access admin activity review", async () => {
    authed(baseUser); // MEMBER, no audit.read
    const res = await getAdminActivity(new Request("http://x/api/admin/activity"));
    expect(res.status).toBe(403);
  });

  it("admin can review activity", async () => {
    authed(adminUser);
    mocks.prisma.auditLog.findMany.mockResolvedValue([{ id: "a1", action: "user.update", targetType: "User", targetId: "u1", actorId: "admin1", createdAt: new Date(), details: null, actor: { id: "admin1", name: "Admin", email: "a@x.com" } }]);
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "u1", name: "U1", email: "u1@x.com" }]);
    const res = await getAdminActivity(new Request("http://x/api/admin/activity?limit=20"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].targetName).toBe("U1");
    expect(body.items[0].actorName).toBe("Admin");
  });
});
