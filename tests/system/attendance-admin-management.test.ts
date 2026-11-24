import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    attendanceRecord: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    requirePermission: vi.fn(),
    syncAttendancePoints: vi.fn(async () => []),
    sendPointNotifications: vi.fn(async () => undefined),
    canAccessCommittee: vi.fn(() => true),
    prisma: {
      attendanceSession: { findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/permissions", () => ({ canAccessCommittee: mocks.canAccessCommittee }));
vi.mock("@/lib/points", () => ({ syncAttendancePoints: mocks.syncAttendancePoints, sendPointNotifications: mocks.sendPointNotifications }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));

import { POST as MANUAL_MARK } from "@/app/api/admin/attendance/sessions/[id]/records/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("admin manual attendance management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN", committeeId: null } });
    mocks.canAccessCommittee.mockReturnValue(true);
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({ id: "s1", committeeId: null, eventId: null, title: "S1", event: null });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "m1", committeeId: null });
    mocks.tx.attendanceRecord.upsert.mockResolvedValue({ id: "r1", status: "PRESENT", user: { id: "m1", name: "Member" } });
  });

  it("allows ADMIN to manually mark attendance for a member", async () => {
    const res = await (MANUAL_MARK as any)(req("http://localhost/api/admin/attendance/sessions/s1/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "m1", status: "PRESENT", reason: "Manual correction" }),
    }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(mocks.tx.attendanceRecord.upsert).toHaveBeenCalled();
  });

  it("blocks unauthorized users from manual attendance management", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Forbidden", status: 403 });
    const res = await (MANUAL_MARK as any)(req("http://localhost/api/admin/attendance/sessions/s1/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "m1", status: "PRESENT", reason: "Manual correction" }),
    }), ctx("s1"));
    expect(res.status).toBe(403);
  });
});
