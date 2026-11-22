import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    attendanceSession: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    attendanceAttempt: { deleteMany: vi.fn(), create: vi.fn() },
    qrToken: { deleteMany: vi.fn(), updateMany: vi.fn() },
    excuse: { deleteMany: vi.fn() },
    event: { delete: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    pointTransaction: { findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn() },
    user: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    tx,
    requirePermission: vi.fn(),
    writeAuditLog: vi.fn(async () => undefined),
    applyEventQrControls: vi.fn(async () => undefined),
    syncEventAttendanceSessions: vi.fn(async () => []),
    verifyQrToken: vi.fn(() => ({ sessionId: "s1", static: true })),
    reverseAttendancePoints: vi.fn(async () => []),
    sendPointNotifications: vi.fn(async () => undefined),
    prisma: {
      event: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      attendanceSession: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
      attendanceRecord: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      attendanceAttempt: { create: vi.fn() },
      qrToken: { updateMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission, getCurrentUser: vi.fn(async () => ({ id: "admin-1", role: "ADMIN", committeeId: null })) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/event-attendance", () => ({
  applyEventQrControls: mocks.applyEventQrControls,
  syncEventAttendanceSessions: mocks.syncEventAttendanceSessions,
}));
vi.mock("@/lib/permissions", () => ({ canAccessCommittee: () => true }));
vi.mock("@/lib/committees", () => ({ isClubCommitteeId: async () => true }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));
vi.mock("@/lib/db-enums", () => ({ AttendanceAttemptStatus: { REJECTED: "REJECTED", SUSPICIOUS: "SUSPICIOUS" }, AttendanceStatus: { PRESENT: "PRESENT", LATE: "LATE" } }));
vi.mock("@/lib/qr-token", () => ({ verifyQrToken: mocks.verifyQrToken, issueQrToken: vi.fn(() => "tok"), rotatingTokenExpiry: vi.fn(() => new Date()) }));
vi.mock("@/lib/security", () => ({ hashIdentifier: vi.fn(() => "hash"), requestIp: vi.fn(() => "1.1.1.1") }));
vi.mock("@/lib/attendance", () => ({ haversineMeters: vi.fn(() => 0), isInsideZone: vi.fn(() => true), isLate: vi.fn(() => false) }));
vi.mock("@/lib/points", () => ({ reverseAttendancePoints: mocks.reverseAttendancePoints, sendPointNotifications: mocks.sendPointNotifications }));

import { DELETE } from "@/app/api/events/[id]/route";
import { POST as ARCHIVE } from "@/app/api/events/[id]/archive/route";
import { POST as RESTORE } from "@/app/api/events/[id]/restore/route";
import { GET as GET_EVENTS } from "@/app/api/events/route";
import { POST as QR_POST } from "@/app/api/admin/attendance/sessions/[id]/qr/route";
import { POST as CHECKIN } from "@/app/api/attendance/check-in/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("event archive/delete/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.$queryRaw.mockReset();
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([]);
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(null);
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]);
    mocks.tx.pointTransaction.findUnique.mockResolvedValue(null);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mocks.reverseAttendancePoints.mockResolvedValue([]);
    mocks.sendPointNotifications.mockResolvedValue(undefined);
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", committeeId: null } });
  });

  it("permanently deletes event and dependent session data in a transaction with correct lock order", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }]) // lock Event first
      .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }]); // lock Sessions ordered by id

    const res = await (DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"));
    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2);
    const firstLock = mocks.tx.$queryRaw.mock.invocationCallOrder[0];
    const secondLock = mocks.tx.$queryRaw.mock.invocationCallOrder[1];
    const firstDelete = mocks.tx.attendanceRecord.deleteMany.mock.invocationCallOrder[0];
    expect(firstLock).toBeLessThan(secondLock);
    expect(secondLock).toBeLessThan(firstDelete);
    expect(mocks.tx.attendanceRecord.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ["s1", "s2"] } } });
    expect(mocks.tx.attendanceAttempt.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ["s1", "s2"] } } });
    expect(mocks.tx.qrToken.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ["s1", "s2"] } } });
    expect(mocks.tx.excuse.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: ["s1", "s2"] } } });
    expect(mocks.tx.attendanceSession.deleteMany).toHaveBeenCalledWith({ where: { eventId: "evt-1", id: { in: ["s1", "s2"] } } });
    expect(mocks.tx.event.delete).toHaveBeenCalledWith({ where: { id: "evt-1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "event.delete.permanent", targetId: "evt-1" }));
  });

  it("returns 404 safely when locked event is missing during permanent deletion", async () => {
    mocks.tx.$queryRaw.mockResolvedValueOnce([]); // Event FOR UPDATE returns no rows
    const res = await (DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"));
    expect(res.status).toBe(404);
    expect(mocks.tx.attendanceRecord.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.event.delete).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "event.delete.permanent" }));
  });

  it("rolls back on permanent deletion failure (no audit success log)", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }])
      .mockResolvedValueOnce([{ id: "s1" }]);
    mocks.prisma.$transaction.mockRejectedValueOnce(new Error("db fail"));

    await expect((DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"))).rejects.toThrow("db fail");
    expect(mocks.writeAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "event.delete.permanent" }));
  });

  it("requires explicit permanent mode", async () => {
    const res = await (DELETE as any)(req("http://localhost/api/events/evt-1", { method: "DELETE" }), ctx("evt-1"));
    expect(res.status).toBe(400);
  });

  it("archives event, closes QR, disables sessions, invalidates tokens, preserves attendance history", async () => {
    mocks.prisma.event.findUnique
      .mockResolvedValueOnce({ id: "evt-1", committeeId: null, archivedAt: null, title: "Event" })
      .mockResolvedValueOnce({ id: "evt-1", archivedAt: new Date().toISOString(), attendanceSessions: [] });
    mocks.tx.attendanceSession.findMany.mockResolvedValue([{ id: "s1" }]);

    const res = await (ARCHIVE as any)(req("http://localhost/api/events/evt-1/archive", { method: "POST" }), ctx("evt-1"));
    expect(res.status).toBe(200);
    expect(mocks.tx.event.update).toHaveBeenCalledWith({ where: { id: "evt-1" }, data: expect.objectContaining({ isOpen: false, qrAttendanceOpen: false }) });
    expect(mocks.tx.attendanceSession.updateMany).toHaveBeenCalledWith({ where: { eventId: "evt-1" }, data: { qrEnabled: false } });
    expect(mocks.tx.qrToken.updateMany).toHaveBeenCalled();
    expect(mocks.tx.attendanceRecord.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.attendanceSession.deleteMany).not.toHaveBeenCalled();
  });

  it("restores archived event", async () => {
    mocks.prisma.event.findUnique
      .mockResolvedValueOnce({ id: "evt-1", committeeId: null, archivedAt: new Date().toISOString(), title: "Event" })
      .mockResolvedValueOnce({ id: "evt-1", archivedAt: null, attendanceSessions: [] });

    const res = await (RESTORE as any)(req("http://localhost/api/events/evt-1/restore", { method: "POST" }), ctx("evt-1"));
    expect(res.status).toBe(200);
    expect(mocks.prisma.event.update).toHaveBeenCalledWith({ where: { id: "evt-1" }, data: { archivedAt: null } });
  });

  it("rejects unauthorized delete/archive/restore", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Forbidden", status: 403 });
    const del = await (DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"));
    const arch = await (ARCHIVE as any)(req("http://localhost/api/events/evt-1/archive", { method: "POST" }), ctx("evt-1"));
    const rest = await (RESTORE as any)(req("http://localhost/api/events/evt-1/restore", { method: "POST" }), ctx("evt-1"));
    expect([del.status, arch.status, rest.status]).toEqual([403, 403, 403]);
  });

  it("excludes archived events from active public and manage lists", async () => {
    mocks.prisma.event.findMany.mockResolvedValue([]);
    await (GET_EVENTS as any)(req("http://localhost/api/events"));
    expect(mocks.prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { published: true, archivedAt: null } }));
    mocks.prisma.event.findMany.mockClear();
    await (GET_EVENTS as any)(req("http://localhost/api/events?manage=true"));
    expect(mocks.prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ archivedAt: null }) }));
  });

  it("prevents QR generation and check-in for archived events", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", committeeId: null } });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({
      id: "s1", eventId: "evt-1", qrSecret: "sec", qrMode: "ROTATING", title: "S", startsAt: new Date(), endsAt: new Date(),
      event: { id: "evt-1", isOpen: false, qrAttendanceOpen: false, archivedAt: new Date() },
    });
    const qr = await (QR_POST as any)(req("http://localhost/api/admin/attendance/sessions/s1/qr?action=issue", { method: "POST" }), ctx("s1"));
    expect(qr.status).toBe(409);

    mocks.requirePermission.mockResolvedValue({ user: { id: "u1", role: "MEMBER", committeeId: null } });
    mocks.verifyQrToken.mockReturnValue({ sessionId: "s1", static: true });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({
      id: "s1", committeeId: null, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000),
      lateAfterMinutes: 10, qrMode: "STATIC", radiusMeters: 100, centerLat: 0, centerLng: 0, qrSecret: "s",
      event: { id: "evt-1", isOpen: true, qrAttendanceOpen: true, archivedAt: new Date() },
    });
    (mocks.prisma.qrToken as any).findUnique = vi.fn(async () => ({ jti: "j1", sessionId: "s1", mode: "STATIC", static: true, expiresAt: new Date(Date.now() + 60000) }));
    const checkin = await (CHECKIN as any)(req("http://localhost/api/attendance/check-in", { method: "POST", body: JSON.stringify({ token: "t".repeat(16), latitude: 0, longitude: 0, accuracy: 5, timestamp: Date.now(), deviceId: "device-12345" }), headers: { "Content-Type": "application/json" } }));
    expect(checkin.status).toBe(403);
  });

  it("cannot commit check-in when event is archived concurrently before transaction revalidation", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "u1", role: "MEMBER", committeeId: null } });
    mocks.verifyQrToken.mockReturnValue({ sessionId: "s1", static: true });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({
      id: "s1", committeeId: null, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000),
      lateAfterMinutes: 10, qrMode: "STATIC", qrEnabled: true, radiusMeters: 100, centerLat: 0, centerLng: 0, qrSecret: "s",
      event: { id: "evt-1", isOpen: true, qrAttendanceOpen: true, archivedAt: null },
    });
    mocks.prisma.qrToken.findUnique = vi.fn(async () => ({ jti: "j1", sessionId: "s1", mode: "STATIC", static: true, expiresAt: new Date(Date.now() + 60000) }));
    mocks.prisma.attendanceAttempt.count = vi.fn(async () => 0);
    mocks.prisma.attendanceAttempt.create = vi.fn(async () => ({ id: "a1" }));

    // Lock order: Event first, then Session (consistent with archive transaction)
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", archivedAt: new Date(), isOpen: false, qrAttendanceOpen: false }])
      .mockResolvedValueOnce([{ id: "s1", eventId: "evt-1", qrEnabled: true, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000), committeeId: null }]);

    const checkin = await (CHECKIN as any)(req("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ token: "t".repeat(16), latitude: 0, longitude: 0, accuracy: 5, timestamp: Date.now(), deviceId: "device-12345" }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(checkin.status).toBe(403);
    const body = await checkin.json();
    expect(body.error).toBe("This event has been archived.");
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.attendanceRecord.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects safely when locked session-event relationship changes unexpectedly", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "u1", role: "MEMBER", committeeId: null } });
    mocks.verifyQrToken.mockReturnValue({ sessionId: "s1", static: true });
    mocks.prisma.attendanceSession.findUnique.mockResolvedValue({
      id: "s1", committeeId: null, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000),
      lateAfterMinutes: 10, qrMode: "STATIC", qrEnabled: true, radiusMeters: 100, centerLat: 0, centerLng: 0, qrSecret: "s",
      event: { id: "evt-1", isOpen: true, qrAttendanceOpen: true, archivedAt: null },
    });
    mocks.prisma.qrToken.findUnique = vi.fn(async () => ({ jti: "j1", sessionId: "s1", mode: "STATIC", static: true, expiresAt: new Date(Date.now() + 60000) }));
    mocks.prisma.attendanceAttempt.count = vi.fn(async () => 0);
    mocks.prisma.attendanceAttempt.create = vi.fn(async () => ({ id: "a1" }));

    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", archivedAt: null, isOpen: true, qrAttendanceOpen: true }])
      .mockResolvedValueOnce([{ id: "s1", eventId: "evt-2", qrEnabled: true, startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + 3600000), committeeId: null }]);

    const checkin = await (CHECKIN as any)(req("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ token: "t".repeat(16), latitude: 0, longitude: 0, accuracy: 5, timestamp: Date.now(), deviceId: "device-12345" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(checkin.status).toBe(409);
    expect(mocks.tx.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it("permanent delete reverses attendance points before deleting records and sends notifications after commit", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }])
      .mockResolvedValueOnce([{ id: "s1" }]);
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([{ id: "r1", userId: "u1" }, { id: "r2", userId: "u2" }]);
    mocks.reverseAttendancePoints
      .mockResolvedValueOnce([{ userId: "u1", amount: -10, reason: "Event permanently deleted: Event", balance: 0, actorId: "admin-1" }])
      .mockResolvedValueOnce([]);

    const res = await (DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"));
    expect(res.status).toBe(200);

    // reversals happened for each record
    expect(mocks.reverseAttendancePoints).toHaveBeenCalledTimes(2);
    expect(mocks.reverseAttendancePoints).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      attendanceRecordId: "r1", userId: "u1", eventId: "evt-1", actorId: "admin-1", reason: "Event permanently deleted: Event",
    }));
    // reversals before record deletion
    const revOrder = mocks.reverseAttendancePoints.mock.invocationCallOrder[1]; // last reversal call
    const delOrder = mocks.tx.attendanceRecord.deleteMany.mock.invocationCallOrder[0];
    expect(revOrder).toBeLessThan(delOrder);
    // notifications sent after commit (after $transaction resolved)
    expect(mocks.sendPointNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.sendPointNotifications).toHaveBeenCalledWith([expect.objectContaining({ userId: "u1", amount: -10 })]);
    // point transactions not deleted
    expect((mocks.tx as any).pointTransaction?.deleteMany).toBeUndefined();
  });

  it("rolls back entire permanent deletion if any point reversal fails", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }])
      .mockResolvedValueOnce([{ id: "s1" }]);
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([{ id: "r1", userId: "u1" }]);
    mocks.reverseAttendancePoints.mockRejectedValueOnce(new Error("points fail"));
    mocks.prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mocks.tx));

    await expect((DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"))).rejects.toThrow("points fail");
    expect(mocks.tx.event.delete).not.toHaveBeenCalled();
    expect(mocks.tx.attendanceRecord.deleteMany).not.toHaveBeenCalled();
    expect(mocks.sendPointNotifications).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: "event.delete.permanent" }));
  });

  it("does not send point notifications when permanent deletion transaction fails", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }])
      .mockResolvedValueOnce([{ id: "s1" }]);
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([{ id: "r1", userId: "u1" }]);
    mocks.reverseAttendancePoints.mockResolvedValue([{ userId: "u1", amount: -10, reason: "x", balance: 0 }]);
    mocks.tx.event.delete.mockRejectedValueOnce(new Error("delete fail"));
    mocks.prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mocks.tx));

    await expect((DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"))).rejects.toThrow("delete fail");
    expect(mocks.sendPointNotifications).not.toHaveBeenCalled();
  });

  it("permanent delete reverses all attendance records across multiple sessions of same event", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }])
      .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }]);
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([
      { id: "r1", userId: "u1" },
      { id: "r2", userId: "u1" },
      { id: "r3", userId: "u2" },
    ]);
    mocks.reverseAttendancePoints.mockResolvedValue([]);

    const res = await (DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"));
    expect(res.status).toBe(200);
    expect(mocks.reverseAttendancePoints).toHaveBeenCalledTimes(3);
    expect(mocks.tx.attendanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: { in: ["s1", "s2"] } },
      orderBy: [{ userId: "asc" }, { id: "asc" }],
    }));
  });

  it("permanent delete does not delete PointTransaction ledger rows (history preserved; FK nulling is DB-enforced)", async () => {
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ id: "evt-1", committeeId: null, title: "Event" }])
      .mockResolvedValueOnce([{ id: "s1" }]);
    mocks.tx.attendanceRecord.findMany.mockResolvedValue([{ id: "r1", userId: "u1" }]);
    mocks.reverseAttendancePoints.mockResolvedValue([{ userId: "u1", amount: -10, reason: "Event permanently deleted: Event", balance: 0 }]);

    const res = await (DELETE as any)(req("http://localhost/api/events/evt-1?mode=permanent", { method: "DELETE" }), ctx("evt-1"));
    expect(res.status).toBe(200);
    // no point transaction deletion
    expect(mocks.tx.pointTransaction.deleteMany).toBeUndefined();
    expect(mocks.tx.pointTransaction.delete).toBeUndefined();
    // reversal was inserted through helper before record deletion
    expect(mocks.reverseAttendancePoints).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ attendanceRecordId: "r1", eventId: "evt-1" }));
  });
});
