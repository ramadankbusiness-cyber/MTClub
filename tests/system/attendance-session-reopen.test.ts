import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    event: { findUnique: vi.fn() },
    attendanceSession: { update: vi.fn() },
  };
  return {
    tx,
    requirePermission: vi.fn(),
    writeAuditLog: vi.fn(async () => undefined),
    prisma: {
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
      attendanceSession: { findUnique: vi.fn() },
      qrToken: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));
vi.mock("@/lib/qr-token", () => ({
  issueQrToken: vi.fn(() => ({ token: "qr-token", jti: "jti-1" })),
  rotatingTokenExpiry: vi.fn((ms: number) => new Date(ms + 30_000)),
}));

import { PATCH as PATCH_SESSION } from "@/app/api/admin/attendance/sessions/[id]/route";
import { POST as QR_POST } from "@/app/api/admin/attendance/sessions/[id]/qr/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("attendance session reopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
  });

  it("reopens an expired session by extending endsAt and preserves historical records/config", async () => {
    const pastStart = new Date(Date.now() - 3_600_000);
    const pastEnd = new Date(Date.now() - 60_000);
    mocks.tx.$queryRaw.mockResolvedValue([{
      id: "s1", title: "Session 1", startsAt: pastStart, endsAt: pastEnd,
      committeeId: "c1", eventId: null, origin: "MANUAL",
    }]);
    const updatedEndsAt = new Date(Date.now() + 60 * 60_000);
    mocks.tx.attendanceSession.update.mockResolvedValue({
      id: "s1", title: "Session 1", startsAt: pastStart, endsAt: updatedEndsAt,
      committeeId: "c1", eventId: null, lateAfterMinutes: 10, qrMode: "ROTATING", qrEnabled: true,
      committee: { id: "c1", name: "IT" }, zone: null, event: null, _count: { records: 7 },
    });

    const res = await (PATCH_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", durationMinutes: 60 }),
    }), ctx("s1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("s1");
    expect(body.session._count.records).toBe(7); // historical records preserved
    expect(mocks.tx.attendanceSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "s1" },
      data: expect.objectContaining({ endsAt: expect.any(Date) }),
    }));
    // Only endsAt is updated
    const updateData = mocks.tx.attendanceSession.update.mock.calls[0][0].data;
    expect(Object.keys(updateData)).toEqual(["endsAt"]);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "attendance.session.reopen",
      targetId: "s1",
      details: expect.objectContaining({ durationMinutes: 60 }),
    }), mocks.tx);
  });

  it("rejects unauthorized reopen attempts", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Forbidden", status: 403 });
    const res = await (PATCH_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", durationMinutes: 60 }),
    }), ctx("s1"));
    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid durations", async () => {
    const res = await (PATCH_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", durationMinutes: 0 }),
    }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not reopen an already active session", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([{
      id: "s1", title: "Active", startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000),
      committeeId: null, eventId: null, origin: "MANUAL",
    }]);
    const res = await (PATCH_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", durationMinutes: 30 }),
    }), ctx("s1"));
    expect(res.status).toBe(409);
    expect(mocks.tx.attendanceSession.update).not.toHaveBeenCalled();
  });

  it("QR becomes available after reopen when session is now active", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({
      id: "s1", qrMode: "ROTATING", qrEnabled: true,
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 30 * 60_000), // reopened / active
      event: null,
    } as any);
    mocks.prisma.qrToken.findFirst.mockResolvedValue(null);
    mocks.prisma.qrToken.create.mockResolvedValue({});

    const res = await (QR_POST as any)(req("http://localhost/api/admin/attendance/sessions/s1/qr", { method: "POST" }), ctx("s1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("qr-token");
  });
});
