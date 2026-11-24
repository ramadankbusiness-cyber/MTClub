import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    attendanceRecord: { findMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    attendanceAttempt: { deleteMany: vi.fn() },
    qrToken: { deleteMany: vi.fn() },
    excuse: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    attendanceSession: { delete: vi.fn() },
  };
  return {
    tx,
    requirePermission: vi.fn(),
    canAccessCommittee: vi.fn(() => true),
    reverseAttendancePoints: vi.fn(async () => [{ userId: "u1", delta: -5 }]),
    sendPointNotifications: vi.fn(async () => undefined),
    writeAuditLog: vi.fn(async () => undefined),
    prisma: {
      attendanceSession: { findUnique: vi.fn() },
      attendanceRecord: { findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/permissions", () => ({ canAccessCommittee: mocks.canAccessCommittee }));
vi.mock("@/lib/points", () => ({ reverseAttendancePoints: mocks.reverseAttendancePoints, sendPointNotifications: mocks.sendPointNotifications }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));

import { DELETE as DELETE_SESSION } from "@/app/api/admin/attendance/sessions/[id]/route";
import { DELETE as DELETE_RECORD } from "@/app/api/admin/attendance/sessions/[id]/records/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("attendance deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "s1", origin: "MANUAL", eventId: null, title: "Session 1" }]);
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([{ id: "r1", userId: "u1" }, { id: "r2", userId: "u2" }]);
    mocks.tx.attendanceAttempt.deleteMany.mockResolvedValue({ count: 1 });
    mocks.tx.qrToken.deleteMany.mockResolvedValue({ count: 1 });
    mocks.tx.excuse.deleteMany.mockResolvedValue({ count: 0 });
    mocks.tx.attendanceRecord.deleteMany.mockResolvedValue({ count: 2 });
    mocks.tx.attendanceSession.delete.mockResolvedValue({ id: "s1" });
    mocks.reverseAttendancePoints.mockResolvedValue([{ userId: "u1", delta: -5 }] as any);
  });

  it("allows authorized admin to delete any attendance session with safe cleanup and point reversal", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });

    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", { method: "DELETE", body: JSON.stringify({ reason: "cleanup" }) }), ctx("s1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mocks.reverseAttendancePoints).toHaveBeenCalledTimes(2);
    expect(mocks.tx.attendanceAttempt.deleteMany).toHaveBeenCalledWith({ where: { sessionId: "s1" } });
    expect(mocks.tx.qrToken.deleteMany).toHaveBeenCalledWith({ where: { sessionId: "s1" } });
    expect(mocks.tx.excuse.deleteMany).toHaveBeenCalledWith({ where: { sessionId: "s1" } });
    expect(mocks.tx.attendanceRecord.deleteMany).toHaveBeenCalledWith({ where: { sessionId: "s1" } });
    expect(mocks.tx.attendanceSession.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.session.delete", targetId: "s1" }), mocks.tx);
    expect(mocks.sendPointNotifications).toHaveBeenCalled();
    expect((mocks.tx as any).pointTransaction).toBeUndefined();
  });

  it("rejects session deletion for non-admin/unauthorized users", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Forbidden", status: 403 });
    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows authorized admin to delete any individual attendance record and reverses points", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({ id: "s1", committeeId: null, eventId: null, title: "Session 1", event: null });
    mocks.prisma.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1", sessionId: "s1" });

    const res = await (DELETE_RECORD as any)(req("http://localhost/api/admin/attendance/sessions/s1/records?userId=u1", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(mocks.reverseAttendancePoints).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ attendanceRecordId: "r1", userId: "u1" }));
    expect(mocks.tx.attendanceRecord.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "attendance.manual.delete" }) }));
    expect(mocks.sendPointNotifications).toHaveBeenCalled();
  });

  it("rejects record deletion when unauthorized", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Forbidden", status: 403 });
    const res = await (DELETE_RECORD as any)(req("http://localhost/api/admin/attendance/sessions/s1/records?userId=u1", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(403);
  });
});
