import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: {}, signIn: {}, signOut: {} }),
  CredentialsSignin: class CredentialsSignin extends Error { code?: string; },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (cfg: unknown) => cfg }));
vi.mock("next-auth/jwt", () => ({ encode: vi.fn(async () => "token") }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));
vi.mock("@/lib/schemas", () => ({ loginSchema: { safeParse: vi.fn() } }));
vi.mock("@/lib/security", () => ({ hashIdentifier: vi.fn(), requestIp: vi.fn() }));
vi.mock("@/lib/login", () => ({
  authenticateCredentials: vi.fn(),
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_WINDOW_MS: 15 * 60 * 1000,
}));

import { jwtCallback } from "@/auth";
import { createSessionTransition } from "@/lib/session-transition";

describe("jwtCallback session transition security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  });

  it("allows current-session password-change transition only with a valid session-bound transition proof and refreshes trusted claims from DB", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: "LEADER",
      committeeId: "committee-db",
      mustChangePassword: false,
      sessionVersion: 8,
      isActive: true,
    });
    const token = { id: "user-1", role: "MEMBER", committeeId: "old", mustChangePassword: true, sessionVersion: 7, sessionJti: "jti-current" };
    const sessionTransition = createSessionTransition({ userId: "user-1", sessionJti: "jti-current", newSessionVersion: 8 });
    const result = await jwtCallback({
      token,
      trigger: "update",
      session: { sessionTransition, user: { id: "attacker", role: "ADMIN", committeeId: "evil", mustChangePassword: false, sessionVersion: 999 } },
    } as any);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { role: true, committeeId: true, mustChangePassword: true, sessionVersion: true, isActive: true, photoUrl: true, googleSubject: true, telegramUserId: true },
    });
    expect(result).toMatchObject({ id: "user-1", role: "LEADER", committeeId: "committee-db", mustChangePassword: false, sessionVersion: 8, sessionJti: "jti-current" });
  });

  it("rejects stale old-session resurrection: old session calling update without authorization remains rejected (reproduction of prior vulnerability)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: "LEADER",
      committeeId: "committee-db",
      mustChangePassword: false,
      sessionVersion: 8,
      isActive: true,
    });
    const oldOtherDeviceToken = { id: "user-1", role: "MEMBER", committeeId: "old", mustChangePassword: true, sessionVersion: 7, sessionJti: "jti-other-device" };
    await expect(jwtCallback({ token: oldOtherDeviceToken, trigger: "update", session: {} } as any)).resolves.toBeNull();
  });

  it("rejects old session trying to reuse another session's transition authorization", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: "LEADER",
      committeeId: "committee-db",
      mustChangePassword: false,
      sessionVersion: 8,
      isActive: true,
    });
    const proofForCurrent = createSessionTransition({ userId: "user-1", sessionJti: "jti-current", newSessionVersion: 8 });
    const oldOtherDeviceToken = { id: "user-1", role: "MEMBER", committeeId: "old", mustChangePassword: true, sessionVersion: 7, sessionJti: "jti-other-device" };
    await expect(jwtCallback({ token: oldOtherDeviceToken, trigger: "update", session: { sessionTransition: proofForCurrent } } as any)).resolves.toBeNull();
  });

  it("rejects expired or forged/client-supplied transition authorization", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: "MEMBER",
      committeeId: "committee-db",
      mustChangePassword: false,
      sessionVersion: 8,
      isActive: true,
    });
    const expired = createSessionTransition({ userId: "user-1", sessionJti: "jti-current", newSessionVersion: 8, now: Date.now() - 10 * 60 * 1000 });
    const token = { id: "user-1", sessionVersion: 7, sessionJti: "jti-current", role: "MEMBER", mustChangePassword: true };
    await expect(jwtCallback({ token: { ...token }, trigger: "update", session: { sessionTransition: expired } } as any)).resolves.toBeNull();
    await expect(jwtCallback({ token: { ...token }, trigger: "update", session: { sessionTransition: "forged.token" } } as any)).resolves.toBeNull();
    await expect(jwtCallback({ token: { ...token }, trigger: "update", session: { sessionTransition: "", user: { role: "ADMIN" } } } as any)).resolves.toBeNull();
  });

  it("rejects replayed/mismatched transition authorization (wrong version or wrong user/session binding)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: "MEMBER",
      committeeId: "committee-db",
      mustChangePassword: false,
      sessionVersion: 9,
      isActive: true,
    });
    const proofForVersion8 = createSessionTransition({ userId: "user-1", sessionJti: "jti-current", newSessionVersion: 8 });
    const token = { id: "user-1", sessionVersion: 7, sessionJti: "jti-current", role: "MEMBER", mustChangePassword: true };
    await expect(jwtCallback({ token, trigger: "update", session: { sessionTransition: proofForVersion8 } } as any)).resolves.toBeNull();

    prismaMock.user.findUnique.mockResolvedValue({ role: "MEMBER", committeeId: null, mustChangePassword: false, sessionVersion: 8, isActive: true });
    const proofForOtherUser = createSessionTransition({ userId: "user-2", sessionJti: "jti-current", newSessionVersion: 8 });
    await expect(jwtCallback({ token: { ...token }, trigger: "update", session: { sessionTransition: proofForOtherUser } } as any)).resolves.toBeNull();
  });

  it("returns null for inactive or deleted users on update and normal requests", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(jwtCallback({ token: { id: "missing", sessionVersion: 1, sessionJti: "j" }, trigger: "update" } as any)).resolves.toBeNull();

    prismaMock.user.findUnique.mockResolvedValueOnce({ role: "MEMBER", committeeId: null, mustChangePassword: false, sessionVersion: 2, isActive: false });
    await expect(jwtCallback({ token: { id: "inactive", sessionVersion: 2, sessionJti: "j" } } as any)).resolves.toBeNull();
  });

  it("keeps strict normal non-update sessionVersion validation", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "MEMBER", committeeId: "committee-db", mustChangePassword: false, sessionVersion: 5, isActive: true });
    await expect(jwtCallback({ token: { id: "user-1", sessionVersion: 4, sessionJti: "j" } } as any)).resolves.toBeNull();

    prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN", committeeId: null, mustChangePassword: false, sessionVersion: 5, isActive: true });
    await expect(jwtCallback({ token: { id: "user-1", sessionVersion: 5, sessionJti: "j", role: "MEMBER", mustChangePassword: true } } as any)).resolves.toMatchObject({ sessionVersion: 5, role: "ADMIN", mustChangePassword: false });
  });

  it("allows idempotent update refresh when token is already at current DB sessionVersion (no transition proof required)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "LEADER", committeeId: "committee-db", mustChangePassword: false, sessionVersion: 8, isActive: true });
    const result = await jwtCallback({ token: { id: "user-1", sessionVersion: 8, sessionJti: "jti-current", role: "MEMBER" }, trigger: "update", session: {} } as any);
    expect(result).toMatchObject({ id: "user-1", sessionVersion: 8, role: "LEADER" });
  });
});
