import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createImmediateNotification: vi.fn(async () => ({ id: "notif-1" })),
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    birthdayDelivery: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    certificate: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb: any) => cb({
      user: { findUnique: mocks.prisma.user.findUnique },
      birthdayDelivery: { update: mocks.prisma.birthdayDelivery.update },
      notification: { create: mocks.prisma.notification.create },
      notificationRecipient: { createMany: vi.fn() },
    })),
  },
  storage: {
    getCertificateStorageDriver: vi.fn(() => "local-private"),
    uploadCertificateFile: vi.fn(async () => ({ key: "certificates/u1/f.pdf", fileName: "f.pdf", fileSize: 10, fileMime: "application/pdf" })),
    createSignedCertificateFileUrl: vi.fn(async () => ({ url: "https://signed.example/cert", expiresIn: 300 })),
    readLocalPrivateCertificateFile: vi.fn(async () => Buffer.from("%PDF-1.4")),
    isSafeCertificateFileKey: vi.fn(() => true),
    CertificateStorageError: class CertificateStorageError extends Error { status: number; constructor(m: string, s: number){ super(m); this.status=s; } },
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/notification-delivery", () => ({
  createImmediateNotification: mocks.createImmediateNotification,
  dispatchPushNotification: vi.fn(async () => {}),
  insertNotificationRecipients: vi.fn(async () => {}),
}));
vi.mock("@/lib/certificate-storage", () => mocks.storage);
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn(async () => ({})) }));

import { dispatchBirthdayNotifications } from "@/lib/birthdays";
import { GET as getMine } from "@/app/api/certificates/mine/route";
import { GET as downloadCert } from "@/app/api/certificates/[id]/download/route";
import { POST as issueCert } from "@/app/api/admin/certificates/route";

function authed(user: any) {
  mocks.auth.mockResolvedValue({ user: { id: user.id } });
  mocks.prisma.user.findUnique.mockResolvedValue(user);
}

describe("Phase 4 birthdays and certificates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sends birthday notification only to active eligible users and dedups same year", async () => {
    const now = new Date("2026-11-27T10:00:00Z");
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "u1", name: "A", preferredLanguage: "en" }]);
    mocks.prisma.birthdayDelivery.findUnique.mockResolvedValueOnce(null);
    mocks.prisma.birthdayDelivery.create.mockResolvedValueOnce({ id: "d1", userId: "u1", year: 2026, status: "PENDING", claimedAt: now });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", isActive: true, notificationPreferences: [] });
    mocks.prisma.notification.create.mockResolvedValue({ id: "n1" });
    mocks.prisma.birthdayDelivery.update.mockResolvedValue({});

    const r1 = await dispatchBirthdayNotifications(now);
    expect(r1.sent).toBe(1);

    // repeated run - SENT record skipped
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "u1", name: "A", preferredLanguage: "en" }]);
    mocks.prisma.birthdayDelivery.findUnique.mockResolvedValueOnce({ id: "d1", userId: "u1", year: 2026, status: "SENT", claimedAt: now });
    const r2 = await dispatchBirthdayNotifications(now);
    expect(r2.sent).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it("retries stale interrupted PENDING delivery (crash-safe)", async () => {
    const now = new Date("2026-11-27T10:00:00Z");
    const stale = new Date(now.getTime() - 16 * 60 * 1000);
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "u1", name: "A", preferredLanguage: "en" }]);
    mocks.prisma.birthdayDelivery.findUnique.mockResolvedValueOnce({ id: "d1", userId: "u1", year: 2026, status: "PENDING", claimedAt: stale });
    mocks.prisma.birthdayDelivery.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", isActive: true, notificationPreferences: [] });
    mocks.prisma.notification.create.mockResolvedValue({ id: "n1" });
    mocks.prisma.birthdayDelivery.update.mockResolvedValue({});

    const r = await dispatchBirthdayNotifications(now);
    expect(r.sent).toBe(1);
    expect(mocks.prisma.birthdayDelivery.updateMany).toHaveBeenCalled();
  });

  it("does not notify inactive users (not returned by eligibility query)", async () => {
    const now = new Date("2026-11-27T10:00:00Z");
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    const r = await dispatchBirthdayNotifications(now);
    expect(r.sent).toBe(0);
  });

  it("member can list own certificates and cannot access others' certificate download", async () => {
    authed({ id: "u1", role: "MEMBER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.certificate.findMany.mockResolvedValue([{ id: "c1", certificateCode: "MT-CERT-1", title: "T", titleAr: null, issuerName: "MT", issuerNameAr: null, issueDate: new Date(), fileName: "a.pdf", fileMime: "application/pdf", fileSize: 10, createdAt: new Date() }]);
    const mine = await getMine();
    expect(mine.status).toBe(200);

    authed({ id: "u2", role: "MEMBER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.certificate.findUnique.mockResolvedValue({ id: "c1", userId: "u1", fileKey: "certificates/u1/f.pdf", fileName: "f.pdf", fileMime: "application/pdf" });
    const dl = await downloadCert(new Request("http://x/api/certificates/c1/download"), { params: Promise.resolve({ id: "c1" }) } as any);
    expect(dl.status).toBe(403);
  });

  it("admin can issue certificate and idempotent retry returns original", async () => {
    authed({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" }) // requirePermission
      .mockResolvedValueOnce({ id: "u1", isActive: true, name: "User 1" }); // target
    mocks.prisma.certificate.findUnique.mockResolvedValueOnce(null); // idempotency check
    mocks.prisma.certificate.create.mockResolvedValue({ id: "cert1", certificateCode: "MT-CERT-2026-X", userId: "u1", title: "T", requestHash: "h", user: { id: "u1", name: "User 1", email: "u@x.com" }, issuedBy: { id: "admin1", name: "Admin" } });

    const fd = new FormData();
    fd.set("userId", "u1"); fd.set("title", "Completion"); fd.set("issuerName", "MT Club"); fd.set("issueDate", "2026-11-27"); fd.set("idempotencyKey", "k1");
    fd.set("file", new File(["pdf"], "cert.pdf", { type: "application/pdf" }));
    const res = await issueCert(new Request("http://x/api/admin/certificates", { method: "POST", body: fd }));
    expect(res.status).toBe(201);

    // retry same key/payload
    authed({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" })
      .mockResolvedValueOnce({ id: "u1", isActive: true, name: "User 1" });
    mocks.prisma.certificate.findUnique.mockResolvedValueOnce({ id: "cert1", certificateCode: "MT-CERT-2026-X", userId: "u1", requestHash: (await (async()=>{const {createHash}=await import('node:crypto'); const fileHash=createHash('sha256').update(Buffer.from('pdf')).digest('hex'); return createHash('sha256').update(JSON.stringify({userId:'u1',title:'Completion',titleAr:null,issuerName:'MT Club',issuerNameAr:null,issueDate:'2026-11-27',fileName:'cert.pdf',fileSize:3,fileMime:'application/pdf',fileHash})).digest('hex');})()), user: { id: "u1", name: "User 1", email: "u@x.com" }, issuedBy: { id: "admin1", name: "Admin" } });
    const fd2 = new FormData();
    fd2.set("userId", "u1"); fd2.set("title", "Completion"); fd2.set("issuerName", "MT Club"); fd2.set("issueDate", "2026-11-27"); fd2.set("idempotencyKey", "k1");
    fd2.set("file", new File(["pdf"], "cert.pdf", { type: "application/pdf" }));
    const res2 = await issueCert(new Request("http://x/api/admin/certificates", { method: "POST", body: fd2 }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).idempotent).toBe(true);
  });

  it("private storage absent returns 503", async () => {
    authed({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" })
      .mockResolvedValueOnce({ id: "u1", isActive: true, name: "User 1" });
    mocks.prisma.certificate.findUnique.mockResolvedValueOnce(null);
    mocks.storage.uploadCertificateFile.mockRejectedValueOnce(new mocks.storage.CertificateStorageError("Certificate storage is currently unavailable.", 503));

    const fd = new FormData();
    fd.set("userId", "u1"); fd.set("title", "T"); fd.set("issuerName", "MT"); fd.set("issueDate", "2026-11-27"); fd.set("idempotencyKey", "k2");
    fd.set("file", new File(["pdf"], "cert.pdf", { type: "application/pdf" }));
    const res = await issueCert(new Request("http://x/api/admin/certificates", { method: "POST", body: fd }));
    expect(res.status).toBe(503);
  });
});
