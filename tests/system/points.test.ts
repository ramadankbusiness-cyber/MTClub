import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    attendanceRecord: { findUnique: vi.fn() },
    attendanceSession: { findUnique: vi.fn() },
    pointTransaction: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    user: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
  createImmediateNotification: vi.fn(async () => ({ id: "n1" })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn(async (cb: any) => cb(mocks.tx)) } }));
vi.mock("@/lib/notification-delivery", () => ({ createImmediateNotification: mocks.createImmediateNotification }));
vi.mock("@/lib/api-error-handler", () => ({ withApiErrorHandling: (fn: unknown) => fn }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canAccessCommittee: () => true }));

import { syncAttendancePoints, reverseAttendancePoints, applyManualPointTransaction, sendPointNotifications } from "@/lib/points";

function setupTx() {
  mocks.tx.$queryRaw.mockReset();
  mocks.tx.$queryRaw.mockImplementation(async (_strings: any, ..._values: any[]) => {
    // default: lock returns empty, insert returns id
    const s = Array.isArray(_strings) ? _strings.join("") : String(_strings);
    if (s.includes("pg_advisory_xact_lock")) return [];
    if (s.includes("INSERT INTO \"PointTransaction\"")) return [{ id: "pt-new" }];
    return [];
  });
  mocks.tx.pointTransaction.aggregate.mockReset().mockResolvedValue({ _sum: { amount: 0 } });
  mocks.tx.pointTransaction.findUnique.mockReset().mockResolvedValue(null);
  mocks.tx.pointTransaction.findMany.mockReset().mockResolvedValue([]);
}

function session(points = 10) {
  return { id: "s1", eventId: "e1", title: "Session", event: { id: "e1", title: "Event", titleAr: "فعالية", attendancePoints: points } };
}
function record(status = "PRESENT") {
  return { id: "r1", userId: "u1", sessionId: "s1", status };
}

describe("points ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTx();
  });

  it("awards configured points for PRESENT and LATE, none for ABSENT", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]); // net 0
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n1 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n1).toHaveLength(1);
    expect(n1[0].amount).toBe(10);

    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("LATE"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n2 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "LATE" });
    expect(n2[0].amount).toBe(10);

    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("ABSENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]);
    const n3 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "ABSENT" });
    expect(n3).toHaveLength(0);
  });

  it("PRESENT -> ABSENT -> PRESENT awards again correctly (net-based)", async () => {
    // PRESENT: net 0, desired 10 => +10
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n1 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n1[0].amount).toBe(10);

    // ABSENT: net 10, desired 0 => -10
    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("ABSENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n2 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "ABSENT" });
    expect(n2[0].amount).toBe(-10);

    // PRESENT again: net 0 (10 + -10), desired 10 => +10
    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([
      { id: "a1", amount: 10, type: "EVENT_ATTENDANCE" },
      { id: "r1x", amount: -10, type: "ATTENDANCE_REVERSAL" },
    ]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n3 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n3[0].amount).toBe(10);
  });

  it("PRESENT -> ABSENT -> PRESENT -> ABSENT keeps correct net balance", async () => {
    const steps = [
      { status: "PRESENT", net: 0, desiredNet: 10, diff: 10 },
      { status: "ABSENT", net: 10, desiredNet: 0, diff: -10 },
      { status: "PRESENT", net: 0, desiredNet: 10, diff: 10 },
      { status: "ABSENT", net: 10, desiredNet: 0, diff: -10 },
    ];
    const ledger: Array<{ id: string; amount: number; type: string }> = [];
    for (const step of steps) {
      setupTx();
      mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record(step.status));
      mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
      mocks.tx.pointTransaction.findMany.mockResolvedValue([...ledger]);
      const currentBalance = ledger.reduce((sum, t) => sum + t.amount, 0);
      mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: Math.max(0, currentBalance) } });
      const n = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: step.status });
      expect(n[0]?.amount ?? 0).toBe(step.diff);
      ledger.push({ id: `t${ledger.length}`, amount: step.diff, type: step.diff > 0 ? "EVENT_ATTENDANCE" : "ATTENDANCE_REVERSAL" });
      const net = ledger.reduce((s, t) => s + t.amount, 0);
      expect(net).toBe(step.desiredNet);
    }
  });

  it("repeated identical synchronization does not create duplicate transactions", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }]); // net 10
    const n = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n).toHaveLength(0);
    // insert should not be called
    const insertCalls = mocks.tx.$queryRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes("INSERT"));
    expect(insertCalls).toHaveLength(0);
  });

  it("changing configured points and synchronizing produces only the required difference", async () => {
    // net 10, event now 15 => +5
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(15));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 15 } });
    const n1 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n1[0].amount).toBe(5);

    // net 15, event now 5 => -10
    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(5));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }, { id: "a2", amount: 5, type: "ATTENDANCE_ADJUSTMENT" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 15 } });
    const n2 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n2[0].amount).toBe(-10);
  });

  it("rejects mismatched user/session and missing record/session", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    await expect(syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u2", sessionId: "s1", newStatus: "PRESENT" })).rejects.toMatchObject({ code: "ATTENDANCE_USER_MISMATCH" });
    await expect(syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s2", newStatus: "PRESENT" })).rejects.toMatchObject({ code: "ATTENDANCE_SESSION_MISMATCH" });

    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(null);
    await expect(syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" })).rejects.toMatchObject({ code: "ATTENDANCE_RECORD_NOT_FOUND" });

    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(null);
    await expect(syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" })).rejects.toMatchObject({ code: "ATTENDANCE_SESSION_NOT_FOUND" });
  });

  it("reverseAttendancePoints reverses only remaining net (not blindly re-reversing)", async () => {
    // net 0 already (10 + -10), should do nothing
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }, { id: "r1", amount: -10, type: "ATTENDANCE_REVERSAL" }]);
    const n = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", reasonBase: "E" });
    expect(n).toHaveLength(0);

    // net 10 remaining, should reverse 10 once
    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n2 = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", reasonBase: "E" });
    expect(n2).toHaveLength(1);
    expect(n2[0].amount).toBe(-10);
  });

  it("manual transactions validate input and prevent negative balance", async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 5 } });
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: -10, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "NEGATIVE_BALANCE" });
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 1.5, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 0, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: Number.NaN, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: Infinity, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 10, reason: "  ", actorId: "admin" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("manual add/deduct creates ledger entry with actor and valid amount", async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 5 } });
    mocks.tx.pointTransaction.findUnique.mockResolvedValue({ id: "pt1", userId: "u1", amount: 10, reason: "Bonus", type: "MANUAL_ADD", actorId: "admin" });
    const result = await applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 10, reason: "Bonus", actorId: "admin" });
    expect(result.balance).toBe(15);
    const insertCall = mocks.tx.$queryRaw.mock.calls.find((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes("INSERT"));
    expect(insertCall).toBeTruthy();
  });

  it("notifications include sign, reason, balance and do not use recipient as creator", async () => {
    mocks.createImmediateNotification.mockClear();
    await sendPointNotifications([{ userId: "u1", amount: 10, reason: "Bonus", balance: 20, actorId: "admin1" }]);
    expect(mocks.createImmediateNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Points Added",
      message: expect.stringContaining("+10"),
      createdById: "admin1",
      userIds: ["u1"],
    }));
    mocks.createImmediateNotification.mockClear();
    await sendPointNotifications([{ userId: "u1", amount: -5, reason: "Adj", balance: 15, actorId: null }]);
    expect(mocks.createImmediateNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Points Deducted",
      message: expect.stringContaining("-5"),
      createdById: null,
    }));
  });

  it("PRESENT -> LATE does not duplicate or change points; LATE -> ABSENT reverses; ABSENT -> PRESENT awards", async () => {
    // PRESENT net 10, LATE desired 10 => no diff
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("LATE"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    const n = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "LATE" });
    expect(n).toHaveLength(0);

    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("ABSENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "a1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n2 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "ABSENT" });
    expect(n2[0].amount).toBe(-10);

    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n3 = await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    expect(n3[0].amount).toBe(10);
  });

  it("manual points reject missing user and preserve actor; unrelated dedupe conflict is not silently ignored", async () => {
    mocks.tx.user.findUnique.mockResolvedValue(null);
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "missing", amount: 10, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    // unrelated unique conflict: ON CONFLICT returned nothing and findUnique by dedupeKey returns null
    setupTx();
    mocks.tx.user.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mocks.tx.$queryRaw.mockImplementation(async (strings: any) => {
      const s = Array.isArray(strings) ? strings.join("") : String(strings);
      if (s.includes("pg_advisory_xact_lock")) return [];
      if (s.includes('INSERT INTO "PointTransaction"')) return []; // conflict, no returning
      return [];
    });
    mocks.tx.pointTransaction.findUnique.mockResolvedValue(null); // dedupeKey not found => unrelated constraint
    await expect(applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 10, reason: "ok", actorId: "admin" })).rejects.toMatchObject({ code: "DEDUPE_CONFLICT" });
  });

  it("acquires per-user advisory lock for sync and manual operations", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue(record("PRESENT"));
    mocks.tx.attendanceSession.findUnique.mockResolvedValue(session(10));
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    await syncAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", sessionId: "s1", newStatus: "PRESENT" });
    const lockCalls = mocks.tx.$queryRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes("pg_advisory_xact_lock"));
    expect(lockCalls.length).toBeGreaterThan(0);

    setupTx();
    mocks.tx.user.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mocks.tx.pointTransaction.findUnique.mockResolvedValue({ id: "pt1" });
    await applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 5, reason: "ok", actorId: "admin" });
    const lockCalls2 = mocks.tx.$queryRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes("pg_advisory_xact_lock"));
    expect(lockCalls2.length).toBeGreaterThan(0);
  });

  it("permanent event deletion reversal: PRESENT record reverses full net attendance points", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "p1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n = await reverseAttendancePoints(mocks.tx as any, {
      attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "Event permanently deleted: E", reason: "Event permanently deleted: E", actorId: "admin"
    });
    expect(n).toHaveLength(1);
    expect(n[0].amount).toBe(-10);
    expect(n[0].reason).toBe("Event permanently deleted: E");
  });

  it("permanent event deletion reversal: LATE record reverses full net attendance points", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "p1", amount: 10, type: "EVENT_ATTENDANCE" }]); // LATE earns same configured points
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n = await reverseAttendancePoints(mocks.tx as any, {
      attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "Event permanently deleted: E", reason: "Event permanently deleted: E"
    });
    expect(n).toHaveLength(1);
    expect(n[0].amount).toBe(-10);
  });

  it("permanent event deletion reversal: ABSENT/EXCUSED records generate no unnecessary reversals", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([]); // net 0
    const n1 = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n1).toHaveLength(0);
    const inserts = mocks.tx.$queryRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes("INSERT INTO \"PointTransaction\""));
    expect(inserts).toHaveLength(0);
  });

  it("permanent event deletion reversal: only remaining net is reversed (partial prior reversal)", async () => {
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    // awarded 10, manually/automatically reversed 4 already => net 6
    mocks.tx.pointTransaction.findMany.mockResolvedValue([
      { id: "p1", amount: 10, type: "EVENT_ATTENDANCE" },
      { id: "p2", amount: -4, type: "ATTENDANCE_REVERSAL" },
    ]);
    mocks.tx.pointTransaction.aggregate.mockReset().mockResolvedValue({ _sum: { amount: 4 } });
    const n = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n).toHaveLength(1);
    expect(n[0].amount).toBe(-6);
  });

  it("permanent event deletion reversal: repeated/concurrent attempts cannot produce duplicate reversals (dedupe)", async () => {
    // first call: net 10, insert returns created
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "p1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10 } });
    const n1 = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n1).toHaveLength(1);

    // retry with same net state: ON CONFLICT DO NOTHING, dedupeKey exists => duplicate
    setupTx();
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "p1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.$queryRaw.mockImplementation(async (strings: any) => {
      const s = Array.isArray(strings) ? strings.join("") : String(strings);
      if (s.includes("pg_advisory_xact_lock")) return [];
      if (s.includes("INSERT INTO \"PointTransaction\"")) return []; // conflict
      return [];
    });
    mocks.tx.pointTransaction.findUnique.mockResolvedValue({ id: "existing", dedupeKey: "attendance:r1:sync:1:0:10" });
    const n2 = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n2).toHaveLength(0);
  });

  it("permanent deletion preserves manual points: reversal only targets attendance net, manual txs unaffected", async () => {
    // Member ledger conceptually: EVENT_ATTENDANCE +10 (r1), MANUAL_ADD +5, MANUAL_DEDUCT -2 => balance 13.
    // Deleting event/record r1 should reverse only attendance net (+10 => -10), leaving manual +3.
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    // getAttendanceNet queries only attendance-related types for this attendanceRecordId
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "p1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockReset().mockResolvedValue({ _sum: { amount: 3 } });
    const n = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n).toHaveLength(1);
    expect(n[0].amount).toBe(-10);
    expect(n[0].balance).toBe(3);
    // ensure attendance net query is scoped to attendanceRecordId and attendance types only
    expect(mocks.tx.pointTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        attendanceRecordId: "r1",
        type: { in: ["EVENT_ATTENDANCE", "ATTENDANCE_ADJUSTMENT", "ATTENDANCE_REVERSAL"] },
      }),
    }));
  });

  it("manual adjustment with same idempotency key is idempotent and does not double-apply", async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    // first call: create
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 5 } });
    mocks.tx.pointTransaction.findUnique.mockResolvedValue({ id: "pt1", userId: "u1", amount: 10, reason: "Bonus", type: "MANUAL_ADD", actorId: "admin" });
    const r1 = await applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 10, reason: "Bonus", actorId: "admin", idempotencyKey: "k1" });
    expect(r1.idempotent).toBe(false);
    expect(r1.balance).toBe(15);

    // second call: insert conflict, dedupeKey exists => idempotent
    setupTx();
    mocks.tx.user.findUnique.mockResolvedValue({ id: "u1", isActive: true });
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: 15 } });
    mocks.tx.$queryRaw.mockImplementation(async (strings: any) => {
      const s = Array.isArray(strings) ? strings.join("") : String(strings);
      if (s.includes("pg_advisory_xact_lock")) return [];
      if (s.includes('INSERT INTO "PointTransaction"')) return []; // conflict
      return [];
    });
    mocks.tx.pointTransaction.findUnique.mockResolvedValue({ id: "pt1", userId: "u1", amount: 10, reason: "Bonus", type: "MANUAL_ADD", actorId: "admin" });
    const r2 = await applyManualPointTransaction(mocks.tx as any, { userId: "u1", amount: 10, reason: "Bonus", actorId: "admin", idempotencyKey: "k1" });
    expect(r2.idempotent).toBe(true);
    expect(r2.balance).toBe(15);
  });

  it("full attendance reversal is preserved even if total balance becomes negative (auditable system correction)", async () => {
    // Scenario: earned +10 attendance, unrelated manual -8 => balance 2; reversing attendance must record full -10.
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([{ id: "p1", amount: 10, type: "EVENT_ATTENDANCE" }]);
    mocks.tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { amount: -8 } }); // balance after full reversal
    const n = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n).toHaveLength(1);
    expect(n[0].amount).toBe(-10); // full reversal, no silent clamp
    expect(n[0].balance).toBe(-8); // system correction may make balance negative; ledger remains auditable
    // reversal tx was inserted
    const inserts = mocks.tx.$queryRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes('INSERT INTO "PointTransaction"'));
    expect(inserts.length).toBeGreaterThan(0);
  });

  it("repeated reversal after full reversal remains idempotent (no double-reverse)", async () => {
    // net already 0 (10 + -10)
    mocks.tx.attendanceRecord.findUnique.mockResolvedValue({ id: "r1", userId: "u1" });
    mocks.tx.pointTransaction.findMany.mockResolvedValue([
      { id: "p1", amount: 10, type: "EVENT_ATTENDANCE" },
      { id: "p2", amount: -10, type: "ATTENDANCE_REVERSAL" },
    ]);
    const n = await reverseAttendancePoints(mocks.tx as any, { attendanceRecordId: "r1", userId: "u1", eventId: "e1", reasonBase: "E" });
    expect(n).toHaveLength(0);
    const inserts = mocks.tx.$queryRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join("").includes('INSERT INTO "PointTransaction"'));
    expect(inserts).toHaveLength(0);
  });
});
