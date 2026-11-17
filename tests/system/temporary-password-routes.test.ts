import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  createTemporaryPassword: vi.fn(() => "TempPass123456"),
  writeAuditLog: vi.fn(async () => undefined),
  dispatchPushNotification: vi.fn(async () => undefined),
  hash: vi.fn(async (value: string) => `bcrypt:${value}`),
  prisma: {
    committee: { findUnique: vi.fn() },
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    passwordResetToken: { deleteMany: vi.fn() },
    notification: { create: vi.fn(async () => ({ id: "notif-1" })) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("@/lib/auth-guards", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/security", () => ({ createTemporaryPassword: mocks.createTemporaryPassword }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/notification-delivery", () => ({ dispatchPushNotification: mocks.dispatchPushNotification }));
vi.mock("@/lib/committees", () => ({
  isClubCommitteeId: vi.fn(async () => true),
  listClubCommittees: vi.fn(async () => []),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));

import { POST as createUser } from "@/app/api/admin/users/route";
import { POST as resetUserPassword } from "@/app/api/admin/users/[id]/route";

describe("admin account creation and temporary password security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.prisma.committee.findUnique.mockResolvedValue(null);
  });

  it("rejects unauthorized user creation", async () => {
    mocks.requirePermission.mockResolvedValueOnce({ error: "Unauthorized", status: 401 });
    const response = await createUser(new Request("http://localhost/api/admin/users", { method: "POST", body: JSON.stringify({}) }));
    expect(response.status).toBe(401);
  });

  it("creates new accounts with fixed initial password mtc123, mustChangePassword true, and no plaintext password in response", async () => {
    mocks.prisma.user.create.mockResolvedValue({
      id: "u2", name: "New User", email: "new@mt.test", role: "ADMIN", position: "LEADER", isMTC: false, committeeId: null,
      phone: "+201000000000", academicNumber: "ACAD-1", clubId: "MT-001",
    });

    const response = await createUser(new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "new@mt.test",
        role: "ADMIN",
        phone: "+201000000000",
        academicNumber: "ACAD-1",
        clubId: "MT-001",
      }),
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBeNull();
    const body = await response.json();
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.user).toMatchObject({ id: "u2", email: "new@mt.test", phone: "+201000000000", academicNumber: "ACAD-1", clubId: "MT-001" });

    expect(mocks.hash).toHaveBeenCalledWith("mtc123", 12);
    expect(mocks.createTemporaryPassword).not.toHaveBeenCalled();
    const createData = mocks.prisma.user.create.mock.calls[0][0].data;
    expect(createData.passwordHash).toBe("bcrypt:mtc123");
    expect(createData.mustChangePassword).toBe(true);
    expect(createData.temporaryPasswordExpiresAt).toBeNull();
    expect(createData.phone).toBe("+201000000000");
    expect(createData.academicNumber).toBe("ACAD-1");
    expect(createData.clubId).toBe("MT-001");
    expect(mocks.writeAuditLog).toHaveBeenCalled();
  });

  it("returns clear conflict errors for duplicate academic number or club ID on create", async () => {
    mocks.prisma.user.create.mockRejectedValueOnce({ code: "P2002", meta: { target: ["User_academicNumber_key"] } });
    const academicResp = await createUser(new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dup", email: "dup@mt.test", role: "ADMIN", academicNumber: "A1" }),
    }));
    expect(academicResp.status).toBe(409);
    expect((await academicResp.json()).error).toMatch(/academic number/i);

    mocks.prisma.user.create.mockRejectedValueOnce({ code: "P2002", meta: { target: ["User_clubId_key"] } });
    const clubResp = await createUser(new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dup", email: "dup2@mt.test", role: "ADMIN", clubId: "C1" }),
    }));
    expect(clubResp.status).toBe(409);
    expect((await clubResp.json()).error).toMatch(/MT Club ID/i);
  });

  it("reset password remains authorized manual recovery and returns a one-time temporary password with no-store", async () => {
    mocks.requirePermission.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u3" });
    const response = await resetUserPassword(new Request("http://localhost/api/admin/users/u3", { method: "POST" }), { params: Promise.resolve({ id: "u3" }) } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.temporaryPassword).toBe("TempPass123456");

    const updateCall = mocks.prisma.user.update.mock.calls[0][0];
    expect(updateCall.data.mustChangePassword).toBe(true);
    expect(updateCall.data.sessionVersion).toEqual({ increment: 1 });
    expect(updateCall.data.temporaryPasswordExpiresAt).toBeInstanceOf(Date);
    expect(updateCall.data.passwordHash).toBe("bcrypt:TempPass123456");
    expect(mocks.prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u3" } });
  });
});
