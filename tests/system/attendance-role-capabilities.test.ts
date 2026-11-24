import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    attendanceRecord: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    requirePermission: vi.fn(),
    verifyQrToken: vi.fn(),
    syncAttendancePoints: vi.fn(async () => []),
    sendPointNotifications: vi.fn(async () => undefined),
    prisma: {
      attendanceSession: { findUnique: vi.fn() },
      qrToken: { findUnique: vi.fn() },
      attendanceAttempt: { create: vi.fn(), count: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/qr-token", () => ({ verifyQrToken: mocks.verifyQrToken }));
vi.mock("@/lib/points", () => ({ syncAttendancePoints: mocks.syncAttendancePoints, sendPointNotifications: mocks.sendPointNotifications }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));

import { POST as CHECKIN } from "@/app/api/attendance/check-in/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }

const validBody = {
  token: "tok".padEnd(16, "x"),
  latitude: 30.0444,
  longitude: 31.2357,
  accuracy: 10,
  timestamp: Date.now(),
  deviceId: "device-123456",
};

describe("attendance self-check-in role capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123456";
    mocks.verifyQrToken.mockReturnValue({ sessionId: "s1", jti: "j1", static: true });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({
      id: "s1", committeeId: null, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000),
      lateAfterMinutes: 10, qrMode: "STATIC", qrEnabled: true, radiusMeters: 100, centerLat: 30.0444, centerLng: 31.2357, qrSecret: "s",
      event: null, zone: null,
    });
    mocks.prisma.qrToken.findUnique.mockResolvedValue({ jti: "j1", sessionId: "s1", mode: "STATIC", static: true, expiresAt: new Date(Date.now() + 60000) });
    mocks.prisma.attendanceAttempt.count.mockResolvedValue(0);
    mocks.prisma.attendanceAttempt.create.mockResolvedValue({ id: "a1" });
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "s1", eventId: null, qrEnabled: true, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000), committeeId: null }]);
    mocks.tx.attendanceRecord.create.mockResolvedValue({ id: "r1", status: "PRESENT", checkedInAt: new Date() });
  });

  it("allows MEMBER QR self-check-in", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "m1", role: "MEMBER", committeeId: null } });
    const res = await (CHECKIN as any)(req("http://localhost/api/attendance/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validBody) }));
    expect(res.status).toBe(200);
    expect(mocks.tx.attendanceRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "m1", sessionId: "s1" }),
    }));
  });

  it("allows ADMIN QR self-check-in with own identity (same flow)", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN", committeeId: null } });
    const res = await (CHECKIN as any)(req("http://localhost/api/attendance/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validBody) }));
    expect(res.status).toBe(200);
    expect(mocks.tx.attendanceRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "admin1", sessionId: "s1" }),
    }));
  });

  it("blocks unauthorized users", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Unauthorized", status: 401 });
    const res = await (CHECKIN as any)(req("http://localhost/api/attendance/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validBody) }));
    expect(res.status).toBe(401);
    expect(mocks.tx.attendanceRecord.create).not.toHaveBeenCalled();
  });
});
