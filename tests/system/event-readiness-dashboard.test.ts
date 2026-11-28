import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  writeAuditLog: vi.fn(async () => ({})),
  prisma: {
    user: { findUnique: vi.fn() },
    event: { findUnique: vi.fn() },
    eventReadiness: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    formEvent: { findMany: vi.fn() },
    formSubmission: { findMany: vi.fn() },
    attendanceSession: { findMany: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb({
      eventReadiness: { create: mocks.prisma.eventReadiness.create, deleteMany: mocks.prisma.eventReadiness.deleteMany },
    })),
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { GET as getReadiness, POST as postReadiness } from "@/app/api/events/[id]/readiness/route";
import { GET as getDashboard } from "@/app/api/events/[id]/dashboard/route";

function jsonReq(url: string, body: any) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const authedMember = { id: "u1", role: "MEMBER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" };

function mockAdmin() {
  mocks.auth.mockResolvedValue({ user: { id: "admin1" } });
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
}

describe("event readiness and dashboard", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("treats concurrent duplicate interested create (P2002 eventId_userId) as idempotent success", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.user.findUnique.mockResolvedValue(authedMember);
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", published: true, archivedAt: null, committeeId: "c1", startsAt: new Date(), title: "E" });
    mocks.prisma.eventReadiness.findUnique.mockResolvedValue(null);
    const p2002: any = new Error("Unique constraint failed");
    p2002.code = "P2002";
    p2002.meta = { target: ["eventId_userId"] };
    mocks.prisma.$transaction.mockRejectedValueOnce(p2002);

    const res = await postReadiness(jsonReq("http://x/api/events/e1/readiness", { action: "interested" }), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, interested: true });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("allows member to express interest and withdraw (idempotent)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.user.findUnique.mockResolvedValue(authedMember);
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", published: true, archivedAt: null, committeeId: "c1", startsAt: new Date(), title: "E" });
    mocks.prisma.eventReadiness.findUnique
      .mockResolvedValueOnce(null) // interested: not existing
      .mockResolvedValueOnce({ id: "r1" }) // interested again: existing
      .mockResolvedValueOnce({ id: "r1" }); // withdraw: existing
    mocks.prisma.eventReadiness.create.mockResolvedValue({ id: "r1" });
    mocks.prisma.eventReadiness.deleteMany.mockResolvedValue({ count: 1 });

    let res = await postReadiness(jsonReq("http://x/api/events/e1/readiness", { action: "interested" }), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(200);
    expect((await res.json()).interested).toBe(true);

    res = await postReadiness(jsonReq("http://x/api/events/e1/readiness", { action: "interested" }), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(200);

    res = await postReadiness(jsonReq("http://x/api/events/e1/readiness", { action: "withdraw" }), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(200);
    expect((await res.json()).interested).toBe(false);
  });

  it("rejects unauthorized and invalid/unpublished events", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    let res = await postReadiness(jsonReq("http://x/api/events/e1/readiness", { action: "interested" }), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(401);

    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.user.findUnique.mockResolvedValue(authedMember);
    mocks.prisma.event.findUnique.mockResolvedValue(null);
    res = await postReadiness(jsonReq("http://x/api/events/bad/readiness", { action: "interested" }), { params: Promise.resolve({ id: "bad" }) } as any);
    expect(res.status).toBe(404);

    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", published: false, archivedAt: null, committeeId: "c1", startsAt: new Date(), title: "E" });
    res = await postReadiness(jsonReq("http://x/api/events/e1/readiness", { action: "interested" }), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(404);
  });

  it("blocks cross-committee leader from dashboard and allows admin", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "leader1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "leader1", role: "LEADER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c2", published: true, archivedAt: null });
    let res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(403);

    mockAdmin();
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c2", published: true, archivedAt: null });
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    mocks.prisma.formEvent.findMany.mockResolvedValue([]);
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([]);
    res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(200);
  });

  it("computes dashboard counts/percentages and keeps states separate", async () => {
    mockAdmin();
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c1", published: true, archivedAt: null });
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([
      { userId: "u1", createdAt: new Date(), user: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
      { userId: "u2", createdAt: new Date(), user: { id: "u2", name: "B", email: "b@x.com", committeeId: "c1" } },
    ]);
    mocks.prisma.formEvent.findMany.mockResolvedValue([{ formId: "f1" }]);
    mocks.prisma.formSubmission.findMany.mockResolvedValue([
      { id: "s1", publicId: "pub1", formId: "f1", respondentUserId: "u1", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
    ]);
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([{ id: "sess1" }]);
    mocks.prisma.attendanceRecord.findMany.mockResolvedValue([
      { userId: "u1", status: "PRESENT", source: "QR", checkedInAt: new Date(), user: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
    ]);

    const res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.interested).toBe(2);
    expect(body.counts.totalRegistrations).toBe(1);
    expect(body.counts.memberRegistrations).toBe(1);
    expect(body.counts.externalRegistrations).toBe(0);
    expect(body.counts.qrVerifiedAttended).toBe(1);
    expect(body.counts.manualAttended).toBe(0);
    expect(body.counts.attendedTotalUnique).toBe(1);
    expect(body.rates.attendancePercentage).toBe(100); // 1 qr / 1 unique member registration
    expect(body.rates.conversionInterestedToRegistered).toBe(50); // 1 interested member registered / 2 interested
  });

  it("distinguishes QR vs manual vs unknown attendance and does not count manual as QR", async () => {
    mockAdmin();
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c1", published: true, archivedAt: null });
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    mocks.prisma.formEvent.findMany.mockResolvedValue([{ formId: "f1" }]);
    mocks.prisma.formSubmission.findMany.mockResolvedValue([
      { id: "s1", publicId: "p1", formId: "f1", respondentUserId: "u1", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
      { id: "s2", publicId: "p2", formId: "f1", respondentUserId: "u2", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u2", name: "B", email: "b@x.com", committeeId: "c1" } },
      { id: "s3", publicId: "p3", formId: "f1", respondentUserId: "u3", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u3", name: "C", email: "c@x.com", committeeId: "c1" } },
    ]);
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([{ id: "sess1" }]);
    mocks.prisma.attendanceRecord.findMany.mockResolvedValue([
      { userId: "u1", status: "PRESENT", source: "QR", checkedInAt: new Date(), user: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
      { userId: "u2", status: "LATE", source: "MANUAL", checkedInAt: new Date(), user: { id: "u2", name: "B", email: "b@x.com", committeeId: "c1" } },
      { userId: "u3", status: "PRESENT", source: "UNKNOWN", checkedInAt: new Date(), user: { id: "u3", name: "C", email: "c@x.com", committeeId: "c1" } },
    ]);

    const res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    const body = await res.json();
    expect(body.counts.qrVerifiedAttended).toBe(1);
    expect(body.counts.manualAttended).toBe(1);
    expect(body.counts.unknownOriginAttended).toBe(1);
    expect(body.counts.attendedTotalUnique).toBe(3);
    // attendance % uses QR-verified / unique member registrations
    expect(body.rates.attendancePercentage).toBe(33.33);
  });

  it("counts authenticated member and external/public registrations separately; avoids double-counting users across forms", async () => {
    mockAdmin();
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c1", published: true, archivedAt: null });
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    mocks.prisma.formEvent.findMany.mockResolvedValue([{ formId: "f1" }, { formId: "f2" }]);
    mocks.prisma.formSubmission.findMany.mockResolvedValue([
      // same member registered in two forms - total submissions 2, unique member 1
      { id: "s1", publicId: "p1", formId: "f1", respondentUserId: "u1", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
      { id: "s2", publicId: "p2", formId: "f2", respondentUserId: "u1", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
      // external with email
      { id: "s3", publicId: "p3", formId: "f1", respondentUserId: null, respondentEmail: "ext@example.com", respondentName: "Ext", submittedAt: new Date(), respondentUser: null },
      // external without stable identity
      { id: "s4", publicId: "p4", formId: "f1", respondentUserId: null, respondentEmail: null, respondentName: "Anon", submittedAt: new Date(), respondentUser: null },
    ]);
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([]);

    const res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    const body = await res.json();
    expect(body.counts.totalRegistrations).toBe(4);
    expect(body.counts.memberRegistrations).toBe(2);
    expect(body.counts.externalRegistrations).toBe(2);
    expect(body.counts.uniqueRegisteredPeople).toBe(2); // u1 + ext@example.com
    expect(body.counts.uniqueRegisteredPeopleIsPartial).toBe(true);
    expect(body.counts.externalWithoutStableIdentity).toBe(1);
  });

  it("handles zero registrations safely", async () => {
    mockAdmin();
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c1", published: true, archivedAt: null });
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    mocks.prisma.formEvent.findMany.mockResolvedValue([]);
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([]);
    const res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    const body = await res.json();
    expect(body.rates.attendancePercentage).toBe(0);
    expect(body.rates.conversionInterestedToRegistered).toBe(0);
  });

  it("does not exceed 100% when QR-attending members are absent from registration submissions", async () => {
    mockAdmin();
    mocks.prisma.event.findUnique.mockResolvedValue({ id: "e1", title: "E", titleAr: null, startsAt: new Date(), committeeId: "c1", published: true, archivedAt: null });
    mocks.prisma.eventReadiness.findMany.mockResolvedValue([]);
    mocks.prisma.formEvent.findMany.mockResolvedValue([{ formId: "f1" }]);
    mocks.prisma.formSubmission.findMany.mockResolvedValue([
      { id: "s1", publicId: "p1", formId: "f1", respondentUserId: "u1", respondentEmail: null, respondentName: null, submittedAt: new Date(), respondentUser: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
    ]);
    mocks.prisma.attendanceSession.findMany.mockResolvedValue([{ id: "sess1" }]);
    mocks.prisma.attendanceRecord.findMany.mockResolvedValue([
      { userId: "u1", status: "PRESENT", source: "QR", checkedInAt: new Date(), user: { id: "u1", name: "A", email: "a@x.com", committeeId: "c1" } },
      { userId: "u2", status: "PRESENT", source: "QR", checkedInAt: new Date(), user: { id: "u2", name: "B", email: "b@x.com", committeeId: "c1" } }, // attended by QR but not registered
    ]);

    const res = await getDashboard(new Request("http://x/api/events/e1/dashboard"), { params: Promise.resolve({ id: "e1" }) } as any);
    const body = await res.json();
    expect(body.counts.qrVerifiedAttended).toBe(2);
    expect(body.rates.attendanceDenominatorValue).toBe(1);
    expect(body.rates.attendanceNumeratorValue).toBe(1);
    expect(body.rates.attendancePercentage).toBe(100);
    expect(body.rates.attendancePercentage).toBeLessThanOrEqual(100);
  });
});
