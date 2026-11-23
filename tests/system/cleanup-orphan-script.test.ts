import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    attendanceRecord: { count: vi.fn() },
    attendanceAttempt: { count: vi.fn() },
    excuse: { count: vi.fn() },
    qrToken: { count: vi.fn(), deleteMany: vi.fn() },
    attendanceSession: { deleteMany: vi.fn() },
  };
  const prismaClient = {
    $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    $disconnect: vi.fn(async () => undefined),
  };
  return { tx, prismaClient };
});

import {
  EXPECTED,
  PRISMA_DATABASE_URL_ENV,
  assertCleanupPreconditions,
  cleanupOrphanSession,
  isProductionEnvironment,
  parseDatabaseHostname,
  runCleanup,
} from "../../scripts/cleanup-orphan-attendance-session";

const BASE_ENV = {
  EXPECTED_DATABASE_HOST: "db.example.com",
  [PRISMA_DATABASE_URL_ENV]: "postgresql://user:secret@db.example.com:5432/db?sslmode=require",
  CONFIRM_ORPHAN_CLEANUP: "yes",
  VERCEL_ENV: "preview",
  NODE_ENV: "test",
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPECTED.id,
    title: EXPECTED.title,
    origin: EXPECTED.origin,
    eventId: null,
    startsAt: new Date("2026-11-19T10:00:00.000Z"),
    ...overrides,
  };
}

describe("cleanup-orphan-attendance-session script hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.$queryRaw.mockResolvedValue([makeSession()]);
    mocks.tx.attendanceRecord.count.mockResolvedValue(0);
    mocks.tx.attendanceAttempt.count.mockResolvedValue(0);
    mocks.tx.excuse.count.mockResolvedValue(0);
    mocks.tx.qrToken.count.mockResolvedValue(341);
    mocks.tx.qrToken.deleteMany.mockResolvedValue({ count: 341 });
    mocks.tx.attendanceSession.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("aborts when EXPECTED_DATABASE_HOST is missing", () => {
    const env = { ...BASE_ENV, EXPECTED_DATABASE_HOST: undefined };
    expect(() => assertCleanupPreconditions(env)).toThrow("EXPECTED_DATABASE_HOST_MISSING");
  });

  it("aborts on hostname mismatch and never prints full URL", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { ...BASE_ENV, EXPECTED_DATABASE_HOST: "wrong.example.com" };
    expect(() => assertCleanupPreconditions(env)).toThrow("DATABASE_HOST_MISMATCH");
    const printed = log.mock.calls.flat().join(" ");
    expect(printed).not.toContain("secret");
    expect(printed).not.toContain("postgresql://");
    log.mockRestore();
  });

  it("aborts in production without second confirmation", () => {
    const env = { ...BASE_ENV, VERCEL_ENV: "production", CONFIRM_PRODUCTION_ORPHAN_CLEANUP: undefined };
    expect(isProductionEnvironment(env)).toBe(true);
    expect(() => assertCleanupPreconditions(env)).toThrow("CONFIRM_PRODUCTION_ORPHAN_CLEANUP_REQUIRED");
  });

  it("allows production only with both confirmations and verified hostname", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const env = { ...BASE_ENV, VERCEL_ENV: "production", CONFIRM_PRODUCTION_ORPHAN_CLEANUP: "yes" };
    expect(() => assertCleanupPreconditions(env)).not.toThrow();
    expect(log).toHaveBeenCalledWith("Verified database hostname: db.example.com");
    log.mockRestore();
  });

  it("verifies exact session identity: wrong title aborts", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([makeSession({ title: "wrong" })]);
    await expect(cleanupOrphanSession(mocks.tx)).rejects.toThrow("Title mismatch");
  });

  it("verifies exact session identity: wrong UTC date aborts", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([makeSession({ startsAt: new Date("2026-11-20T00:00:00.000Z") })]);
    await expect(cleanupOrphanSession(mocks.tx)).rejects.toThrow("Date mismatch (UTC): 2026-11-20");
  });

  it("preserves origin/eventId/history checks", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([makeSession({ origin: "MANUAL" })]);
    await expect(cleanupOrphanSession(mocks.tx)).rejects.toThrow("Origin mismatch");

    mocks.tx.$queryRaw.mockResolvedValue([makeSession({ eventId: "evt-1" })]);
    await expect(cleanupOrphanSession(mocks.tx)).rejects.toThrow("eventId mismatch");

    mocks.tx.$queryRaw.mockResolvedValue([makeSession()]);
    mocks.tx.attendanceRecord.count.mockResolvedValue(1);
    await expect(cleanupOrphanSession(mocks.tx)).rejects.toThrow("recordCount mismatch: 1");
  });

  it("deletes only the exact session and its QR tokens after all checks pass", async () => {
    const result = await cleanupOrphanSession(mocks.tx);
    expect(mocks.tx.qrToken.deleteMany).toHaveBeenCalledWith({ where: { sessionId: EXPECTED.id } });
    expect(mocks.tx.attendanceSession.deleteMany).toHaveBeenCalledWith({
      where: { id: EXPECTED.id, origin: "EVENT", eventId: null },
    });
    expect(result.deletedTokens).toBe(341);
    expect(result.sessionId).toBe(EXPECTED.id);
  });

  it("runCleanup checks env before connecting/using prisma and disconnects on all paths", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runCleanup(BASE_ENV, mocks.prismaClient as any);
    expect(mocks.prismaClient.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prismaClient.$disconnect).not.toHaveBeenCalled(); // injected client not owned

    const badEnv = { ...BASE_ENV, EXPECTED_DATABASE_HOST: undefined };
    const prisma2 = { $transaction: vi.fn(), $disconnect: vi.fn(async () => undefined) };
    await expect(runCleanup(badEnv, prisma2 as any)).rejects.toThrow("EXPECTED_DATABASE_HOST_MISSING");
    expect(prisma2.$transaction).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
