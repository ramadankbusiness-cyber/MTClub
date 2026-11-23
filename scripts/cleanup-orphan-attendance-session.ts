/**
 * SAFE, MANUAL cleanup procedure for a confirmed orphaned AttendanceSession.
 *
 * DO NOT run against production automatically.
 * DO NOT execute without explicit confirmations and verified environment.
 *
 * Required order if migration 20261122000000_add_attendance_session_origin
 * has not been deployed yet:
 *   1) Deploy/apply the migration first.
 *   2) Regenerate Prisma client.
 *   3) Run this script with explicit confirmation in the verified environment.
 *
 * Usage (local/staging only, after migration applied):
 *   EXPECTED_DATABASE_HOST=<hostname> CONFIRM_ORPHAN_CLEANUP=yes npx tsx scripts/cleanup-orphan-attendance-session.ts
 *
 * Production requires an additional explicit confirmation:
 *   EXPECTED_DATABASE_HOST=<hostname> CONFIRM_ORPHAN_CLEANUP=yes CONFIRM_PRODUCTION_ORPHAN_CLEANUP=yes npx tsx scripts/cleanup-orphan-attendance-session.ts
 */

import { pathToFileURL } from "node:url";
import { PrismaClient } from "../lib/generated/prisma";

export const TARGET_SESSION_ID = "cmwnmnzi00003jw081941z09f";

export const EXPECTED = {
  id: TARGET_SESSION_ID,
  title: "ايفنت الهاندميد",
  origin: "EVENT",
  eventId: null as string | null,
  // Session dates are stored as DateTime (UTC timestamp). The confirmed orphan's
  // original date is November 19, 2026; validate the UTC date explicitly.
  startsAtUtcDate: "2026-11-19",
  recordCount: 0,
  attemptCount: 0,
  excuseCount: 0,
} as const;

// Prisma datasource in prisma/schema.prisma uses env("DATABASE_URL").
export const PRISMA_DATABASE_URL_ENV = "DATABASE_URL";

export type CleanupEnv = Record<string, string | undefined>;

export function getActiveDatabaseUrl(env: CleanupEnv = process.env): string | undefined {
  const value = env[PRISMA_DATABASE_URL_ENV];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseDatabaseHostname(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  const hostname = parsed.hostname.trim();
  if (!hostname) throw new Error("DATABASE_URL_HOST_MISSING");
  return hostname;
}

export function isProductionEnvironment(env: CleanupEnv = process.env): boolean {
  // Actual project env vars: VERCEL_ENV is provided by Vercel deployments; NODE_ENV is used by runtime/build.
  if (env.VERCEL_ENV === "production") return true;
  if (env.NODE_ENV === "production") return true;
  return false;
}

export function assertCleanupPreconditions(env: CleanupEnv = process.env): { hostname: string } {
  const expectedHost = env.EXPECTED_DATABASE_HOST?.trim();
  if (!expectedHost) throw new Error("EXPECTED_DATABASE_HOST_MISSING");

  const databaseUrl = getActiveDatabaseUrl(env);
  if (!databaseUrl) throw new Error("DATABASE_URL_MISSING");

  const hostname = parseDatabaseHostname(databaseUrl);
  if (hostname !== expectedHost) throw new Error("DATABASE_HOST_MISMATCH");

  if (env.CONFIRM_ORPHAN_CLEANUP !== "yes") {
    throw new Error("CONFIRM_ORPHAN_CLEANUP_REQUIRED");
  }

  if (isProductionEnvironment(env) && env.CONFIRM_PRODUCTION_ORPHAN_CLEANUP !== "yes") {
    throw new Error("CONFIRM_PRODUCTION_ORPHAN_CLEANUP_REQUIRED");
  }

  // Print only the verified hostname, never credentials or full URL.
  console.log(`Verified database hostname: ${hostname}`);
  return { hostname };
}

export function utcDateString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_SESSION_DATE");
  return date.toISOString().slice(0, 10);
}

export type LockedSessionRow = {
  id: string;
  title: string;
  origin: string;
  eventId: string | null;
  startsAt: Date | string;
};

export async function cleanupOrphanSession(tx: any, expected = EXPECTED) {
  const locked = await tx.$queryRaw<Array<LockedSessionRow>>`
    SELECT id, title, origin, "eventId", "startsAt"
    FROM "AttendanceSession"
    WHERE id = ${expected.id}
    FOR UPDATE
  `;
  const session = locked[0];
  if (!session) throw new Error(`Session not found: ${expected.id}`);
  if (session.id !== expected.id) throw new Error("Unexpected session ID.");
  if (session.title !== expected.title) throw new Error(`Title mismatch: ${session.title}`);
  if (session.origin !== expected.origin) throw new Error(`Origin mismatch: ${session.origin}`);
  if (session.eventId !== expected.eventId) throw new Error(`eventId mismatch: ${String(session.eventId)}`);

  const startsAtUtcDate = utcDateString(session.startsAt);
  if (startsAtUtcDate !== expected.startsAtUtcDate) {
    throw new Error(`Date mismatch (UTC): ${startsAtUtcDate}`);
  }

  const [recordCount, attemptCount, excuseCount, qrTokenCount] = await Promise.all([
    tx.attendanceRecord.count({ where: { sessionId: expected.id } }),
    tx.attendanceAttempt.count({ where: { sessionId: expected.id } }),
    tx.excuse.count({ where: { sessionId: expected.id } }),
    tx.qrToken.count({ where: { sessionId: expected.id } }),
  ]);

  if (recordCount !== expected.recordCount) throw new Error(`recordCount mismatch: ${recordCount}`);
  if (attemptCount !== expected.attemptCount) throw new Error(`attemptCount mismatch: ${attemptCount}`);
  if (excuseCount !== expected.excuseCount) throw new Error(`excuseCount mismatch: ${excuseCount}`);

  // Delete only this exact session's QR tokens and the session itself.
  const deletedTokens = await tx.qrToken.deleteMany({ where: { sessionId: expected.id } });
  const deletedSession = await tx.attendanceSession.deleteMany({
    where: { id: expected.id, origin: "EVENT", eventId: null },
  });
  if (deletedSession.count !== 1) {
    throw new Error(`Expected to delete 1 session, deleted ${deletedSession.count}`);
  }

  return {
    sessionId: expected.id,
    title: session.title,
    qrTokenCount,
    deletedTokens: deletedTokens.count,
  };
}

export async function runCleanup(env: CleanupEnv = process.env, prismaClient?: PrismaClient) {
  const { hostname } = assertCleanupPreconditions(env);
  const prisma = prismaClient ?? new PrismaClient();
  const shouldDisconnect = !prismaClient;
  try {
    const result = await prisma.$transaction(async (tx) => cleanupOrphanSession(tx));
    console.log("Cleanup completed for exact orphan session:", result);
    return { hostname, ...result };
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}

function isDirectExecution(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  return import.meta.url === pathToFileURL(arg).href;
}

if (isDirectExecution()) {
  runCleanup().catch((err) => {
    console.error("Cleanup aborted:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
