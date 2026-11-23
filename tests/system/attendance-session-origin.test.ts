import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    attendanceRecord: { count: vi.fn() },
    attendanceAttempt: { count: vi.fn() },
    excuse: { count: vi.fn() },
    qrToken: { deleteMany: vi.fn() },
    attendanceSession: { delete: vi.fn(), deleteMany: vi.fn() },
  };
  return {
    tx,
    requirePermission: vi.fn(),
    writeAuditLog: vi.fn(async () => undefined),
    prisma: {
      attendanceSession: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));

import { GET as GET_SESSIONS } from "@/app/api/admin/attendance/sessions/route";
import { DELETE as DELETE_SESSION } from "@/app/api/admin/attendance/sessions/[id]/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

describe("attendance session origin/orphan cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.$queryRaw.mockReset();
    mocks.tx.attendanceRecord.count.mockResolvedValue(0);
    mocks.tx.attendanceAttempt.count.mockResolvedValue(0);
    mocks.tx.excuse.count.mockResolvedValue(0);
    mocks.tx.qrToken.deleteMany.mockResolvedValue({ count: 2 });
    mocks.tx.attendanceSession.delete.mockResolvedValue({ id: "s-orphan" });
  });

  it("ADMIN query returns manual null-event sessions and active event sessions, excludes orphaned EVENT null-event and archived event sessions", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN", committeeId: null } });
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([]);

    const res = await (GET_SESSIONS as any)(req("http://localhost/api/admin/attendance/sessions"));
    expect(res.status).toBe(200);
    expect(mocks.prisma.attendanceSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { origin: "MANUAL" },
          { origin: "EVENT", eventId: { not: null }, event: { archivedAt: null } },
        ],
      },
    }));
  });

  it("LEADER query applies same origin filter and committee isolation", async () => {
    mocks.requirePermission
      .mockResolvedValueOnce({ error: "Forbidden", status: 403 }) // attendance.read.all
      .mockResolvedValueOnce({ user: { id: "leader1", role: "LEADER", committeeId: "c1" } }); // attendance.read.committee
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([]);

    const res = await (GET_SESSIONS as any)(req("http://localhost/api/admin/attendance/sessions"));
    expect(res.status).toBe(200);
    expect(mocks.prisma.attendanceSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { OR: [{ committeeId: null }, { committeeId: "c1" }] },
          {
            OR: [
              { origin: "MANUAL" },
              { origin: "EVENT", eventId: { not: null }, event: { archivedAt: null } },
            ],
          },
        ],
      },
    }));
  });

  it("rejects manual session deletion by orphan cleanup endpoint", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ id: "s1", origin: "MANUAL", eventId: null, title: "Manual" }]);

    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(409);
    expect(mocks.tx.attendanceSession.delete).not.toHaveBeenCalled();
  });

  it("rejects active event session deletion (origin EVENT with eventId)", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ id: "s1", origin: "EVENT", eventId: "evt-1", title: "Event" }]);

    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s1", { method: "DELETE" }), ctx("s1"));
    expect(res.status).toBe(409);
    expect(mocks.tx.qrToken.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes orphan only when history counts are zero; removes QR tokens and session atomically; writes audit log", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ id: "s-orphan", origin: "EVENT", eventId: null, title: "ايفنت الهاندميد" }]);

    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s-orphan", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Confirmed orphan cleanup" }),
    }), ctx("s-orphan"));

    expect(res.status).toBe(200);
    expect(mocks.tx.attendanceRecord.count).toHaveBeenCalledWith({ where: { sessionId: "s-orphan" } });
    expect(mocks.tx.attendanceAttempt.count).toHaveBeenCalledWith({ where: { sessionId: "s-orphan" } });
    expect(mocks.tx.excuse.count).toHaveBeenCalledWith({ where: { sessionId: "s-orphan" } });
    expect(mocks.tx.qrToken.deleteMany).toHaveBeenCalledWith({ where: { sessionId: "s-orphan" } });
    expect(mocks.tx.attendanceSession.delete).toHaveBeenCalledWith({ where: { id: "s-orphan" } });
    // PointTransaction history never modified
    expect((mocks.tx as any).pointTransaction).toBeUndefined();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "admin1",
      action: "attendance.session.orphan_cleanup",
      targetType: "AttendanceSession",
      targetId: "s-orphan",
      details: expect.objectContaining({ title: "ايفنت الهاندميد", reason: "Confirmed orphan cleanup" }),
    }), mocks.tx);
  });

  it("rejects orphan deletion when records/attempts/excuses exist (409)", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ id: "s-orphan", origin: "EVENT", eventId: null, title: "Orphan" }]);
    mocks.tx.attendanceRecord.count.mockResolvedValue(1);

    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s-orphan", { method: "DELETE" }), ctx("s-orphan"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/history/i);
    expect(mocks.tx.qrToken.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.attendanceSession.delete).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("cleanup transaction rolls back on failure (no audit log)", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ id: "s-orphan", origin: "EVENT", eventId: null, title: "Orphan" }]);
    mocks.tx.attendanceSession.delete.mockRejectedValueOnce(new Error("db fail"));
    mocks.prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mocks.tx));

    await expect((DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s-orphan", { method: "DELETE" }), ctx("s-orphan"))).rejects.toThrow("db fail");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("requires admin manage permission (leaders denied)", async () => {
    mocks.requirePermission.mockResolvedValue({ error: "Forbidden", status: 403 });
    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s-orphan", { method: "DELETE" }), ctx("s-orphan"));
    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("enforces ADMIN role explicitly even if permission check passes", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "leader1", role: "LEADER", committeeId: "c1" } });
    const res = await (DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s-orphan", { method: "DELETE" }), ctx("s-orphan"));
    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back entire deletion if audit log creation fails", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ id: "s-orphan", origin: "EVENT", eventId: null, title: "Orphan" }]);
    mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit fail"));
    mocks.prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(mocks.tx));

    await expect((DELETE_SESSION as any)(req("http://localhost/api/admin/attendance/sessions/s-orphan", { method: "DELETE" }), ctx("s-orphan"))).rejects.toThrow("audit fail");
    expect(mocks.tx.qrToken.deleteMany).toHaveBeenCalled(); // attempted inside tx, but tx would roll back in real DB
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "attendance.session.orphan_cleanup" }), mocks.tx);
  });
});
