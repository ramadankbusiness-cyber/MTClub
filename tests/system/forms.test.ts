import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    form: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    formField: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    formEvent: { deleteMany: vi.fn(), createMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
    formSubmission: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    formAnswer: { findUnique: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    formUpload: { count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    event: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: any) => fn(mocks.prisma)),
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/form-file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/form-file-storage")>();
  return {
    ...actual,
    getFormStorageDriver: vi.fn(() => "supabase-private"),
    uploadFormFile: vi.fn(async (_file: File, formId: string, fieldId: string, key?: string) => ({
      key: key || `forms/${formId}/${fieldId}/mock.txt`,
      fileName: "test.txt",
      fileSize: 5,
      fileMime: "text/plain",
    })),
    createSignedFormFileUrl: vi.fn(async () => ({ url: "https://signed.example/file", expiresIn: 300 })),
    readLocalPrivateFormFile: vi.fn(async () => Buffer.from("test")),
    deleteFormFileIfUnreferenced: vi.fn(async () => true),
  };
});

import { POST as submitForm } from "@/app/api/public/forms/[slug]/submit/route";
import { GET as getPublicForm } from "@/app/api/public/forms/[slug]/route";
import { POST as createForm } from "@/app/api/forms/route";

function req(url: string, init?: RequestInit) { return new Request(url, init); }
function jsonReq(url: string, method: string, body: any) { return new Request(url, { method, headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify(body) }); }

const baseForm = {
  id: "form1", publicSlug: "slug1", title: "Test", titleAr: null, description: null, descriptionAr: null,
  accessMode: "PUBLIC", status: "PUBLISHED", opensAt: null, closesAt: null, maxResponses: null, duplicatePolicy: "ALLOW",
  fields: [
    { id: "f1", type: "SHORT_ANSWER", label: "Name", labelAr: null, description: null, descriptionAr: null, required: true, order: 0, options: null, validation: null },
    { id: "f2", type: "EMAIL", label: "Email", labelAr: null, description: null, descriptionAr: null, required: false, order: 1, options: null, validation: null },
  ],
  _count: { submissions: 0 },
};

describe("forms system", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-32-chars!!";
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn(mocks.prisma));
  });

  it("allows public submission without authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm });
    mocks.prisma.formSubmission.count.mockResolvedValue(0);
    mocks.prisma.formSubmission.create.mockResolvedValue({ id: "s1", publicId: "pub1", submittedAt: new Date() });
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "f1", value: "Alice" }], website: "" }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(201);
  });

  it("rejects submission when required field missing", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm });
    mocks.prisma.formSubmission.count.mockResolvedValue(0);
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [], website: "" }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(400);
  });

  it("blocks member-only form for unauthenticated user", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, accessMode: "MEMBERS_ONLY" });
    const res = await getPublicForm(req("http://x/api/public/forms/slug1"), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(401);
  });

  it("blocks authenticated-users form for unauthenticated user", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, accessMode: "AUTHENTICATED_USERS" });
    const res = await getPublicForm(req("http://x/api/public/forms/slug1"), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(401);
  });

  it("allows authenticated-users form for logged-in user", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, accessMode: "AUTHENTICATED_USERS", eventLinks: [] });
    const res = await getPublicForm(req("http://x/api/public/forms/slug1"), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(200);
  });

  it("rejects closed form submissions", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, status: "CLOSED" });
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "f1", value: "A" }] }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(400);
  });

  it("rejects submission when response limit reached", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, maxResponses: 1, _count: { submissions: 1 } });
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "f1", value: "A" }] }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(400);
  });

  it("enforces duplicate ONE_PER_IP policy", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, duplicatePolicy: "ONE_PER_IP" });
    mocks.prisma.formSubmission.count.mockResolvedValue(0);
    mocks.prisma.formSubmission.findFirst.mockResolvedValue({ id: "existing" });
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "f1", value: "A" }] }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(409);
  });

  it("requires forms.create permission to create form", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    const res = await createForm(jsonReq("http://x/api/forms", "POST", { title: "X", accessMode: "PUBLIC", duplicatePolicy: "ALLOW", fields: [] }));
    expect(res.status).toBe(403);
  });

  it("blocks public submission when form is archived", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, status: "ARCHIVED" });
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "f1", value: "A" }] }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(400);
  });

  it("does not expose raw storage keys in upload response", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm, fields: [{ id: "f1", type: "FILE_UPLOAD" }], _count: { submissions: 0 } });
    mocks.prisma.formUpload.count.mockResolvedValue(0);
    mocks.prisma.formUpload.create.mockResolvedValue({ id: "upl1", key: "forms/form1/f1/mock.txt", tokenJti: "jti-1234567890" });
    mocks.prisma.formUpload.update.mockResolvedValue({});
    const fd = new FormData();
    fd.append("fieldId", "f1");
    fd.append("file", new File(["hello"], "test.txt", { type: "text/plain" }));
    const res = await (await import("@/app/api/public/forms/[slug]/upload/route")).POST(new Request("http://x/api/public/forms/slug1/upload", { method: "POST", body: fd, headers: { "x-forwarded-for": "1.2.3.4" } }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    const data = await res.json().catch(() => null);
    expect(res.status).toBe(200);
    expect(data.file?.token).toBeTruthy();
    expect(data.file?.key).toBeUndefined();
  });

  it("blocks export for unauthorized user", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    const { GET: exportResponses } = await import("@/app/api/forms/[id]/responses/export/route");
    const res = await exportResponses(new Request("http://x/api/forms/form1/responses/export?format=csv"), { params: Promise.resolve({ id: "form1" }) } as any);
    expect(res.status).toBe(403);
  });

  it("upload token: cannot be tampered, cross-form, or cross-field", async () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-32-chars!!";
    const { signFormUploadToken, verifyFormUploadToken } = await import("@/lib/form-file-storage");
    const token = signFormUploadToken({ key: "forms/f1/field1/abc.txt", formId: "f1", fieldId: "field1", fileName: "abc.txt", fileSize: 10, fileMime: "text/plain" });
    expect(verifyFormUploadToken(token, "f1", "field1")).toBeTruthy();
    expect(verifyFormUploadToken(token + "x", "f1", "field1")).toBeNull(); // tampered
    expect(verifyFormUploadToken(token, "f2", "field1")).toBeNull(); // cross-form
    expect(verifyFormUploadToken(token, "f1", "field2")).toBeNull(); // cross-field
  });

  it("upload token: expires and replay is rejected when consumed", async () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-32-chars!!";
    const { signFormUploadToken, verifyFormUploadToken } = await import("@/lib/form-file-storage");
    const token = signFormUploadToken({ key: "forms/f1/field1/abc.txt", formId: "f1", fieldId: "field1", fileName: "abc.txt", fileSize: 10, fileMime: "text/plain" });
    expect(verifyFormUploadToken(token, "f1", "field1", { consume: true })).toBeTruthy();
    expect(verifyFormUploadToken(token, "f1", "field1", { consume: true })).toBeNull(); // replay
    // expired token
    const origNow = Date.now;
    Date.now = () => origNow() + 31 * 60 * 1000;
    const expired = signFormUploadToken({ key: "forms/f1/field1/abc.txt", formId: "f1", fieldId: "field1", fileName: "abc.txt", fileSize: 10, fileMime: "text/plain" });
    Date.now = () => origNow() + 62 * 60 * 1000;
    expect(verifyFormUploadToken(expired, "f1", "field1")).toBeNull();
    Date.now = origNow;
  });

  it("blocks file download for unauthorized/cross-committee users and allows authorized admin", async () => {
    const { GET: downloadFile } = await import("@/app/api/forms/[id]/responses/[submissionId]/file/route");
    // unauthorized member
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", role: "MEMBER", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    let res = await downloadFile(new Request("http://x/api/forms/form1/responses/sub1/file?fieldId=field1"), { params: Promise.resolve({ id: "form1", submissionId: "sub1" }) } as any);
    expect(res.status).toBe(403);

    // cross-committee leader
    mocks.auth.mockResolvedValue({ user: { id: "leader1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "leader1", role: "LEADER", committeeId: "c1", isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.form.findUnique.mockResolvedValue({ id: "form1", createdById: "someone-else", eventLinks: [{ event: { committeeId: "c2" } }] });
    res = await downloadFile(new Request("http://x/api/forms/form1/responses/sub1/file?fieldId=field1"), { params: Promise.resolve({ id: "form1", submissionId: "sub1" }) } as any);
    expect(res.status).toBe(403);

    // authorized admin with valid ownership chain
    mocks.auth.mockResolvedValue({ user: { id: "admin1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.form.findUnique.mockResolvedValue({ id: "form1", createdById: "admin1", eventLinks: [] });
    mocks.prisma.formSubmission.findUnique.mockResolvedValue({ id: "sub1", formId: "form1" });
    mocks.prisma.formAnswer.findUnique.mockResolvedValue({ id: "a1", fieldId: "field1", submissionId: "sub1", fileKey: "forms/form1/field1/file.txt", fileName: "file.txt", fileMime: "text/plain", fileSize: 5 });
    res = await downloadFile(new Request("http://x/api/forms/form1/responses/sub1/file?fieldId=field1"), { params: Promise.resolve({ id: "form1", submissionId: "sub1" }) } as any);
    expect([200,302]).toContain(res.status);
  });

  it("rejects download when submission/answer does not belong to form", async () => {
    const { GET: downloadFile } = await import("@/app/api/forms/[id]/responses/[submissionId]/file/route");
    mocks.auth.mockResolvedValue({ user: { id: "admin1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "admin1", role: "ADMIN", committeeId: null, isActive: true, mustChangePassword: false, googleSubject: "g", telegramUserId: "t" });
    mocks.prisma.form.findUnique.mockResolvedValue({ id: "form1", createdById: "admin1", eventLinks: [] });
    mocks.prisma.formSubmission.findUnique.mockResolvedValue({ id: "sub1", formId: "other-form" });
    const res = await downloadFile(new Request("http://x/api/forms/form1/responses/sub1/file?fieldId=field1"), { params: Promise.resolve({ id: "form1", submissionId: "sub1" }) } as any);
    expect(res.status).toBe(404);
  });

  it("returns 409 on serialization conflict after bounded retries", async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({ ...baseForm });
    mocks.prisma.formSubmission.count.mockResolvedValue(0);
    const err: any = new Error("serialization"); err.code = "P2034";
    mocks.prisma.$transaction.mockRejectedValue(err);
    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "f1", value: "Alice" }], website: "" }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(409);
  });

  it("cleans up consumed upload object when submission is not persisted", async () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-32-chars!!";
    const { signFormUploadToken, deleteFormFileIfUnreferenced } = await import("@/lib/form-file-storage");
    mocks.auth.mockResolvedValue(null);
    mocks.prisma.form.findUnique.mockResolvedValue({
      ...baseForm,
      fields: [{ id: "fFile", type: "FILE_UPLOAD", label: "File", labelAr: null, description: null, descriptionAr: null, required: true, order: 0, options: null, validation: null }],
      _count: { submissions: 0 },
    });
    mocks.prisma.formSubmission.count.mockResolvedValue(0);
    const jti = "test-jti-1234567890";
    const token = signFormUploadToken({ key: "forms/form1/fFile/test-uuid.txt", formId: "form1", fieldId: "fFile", fileName: "test.txt", fileSize: 10, fileMime: "text/plain", jti, exp: Date.now() + 30 * 60 * 1000 });
    mocks.prisma.formUpload.findUnique.mockResolvedValue({
      id: "upl1", formId: "form1", fieldId: "fFile", key: "forms/form1/fFile/test-uuid.txt", status: "PENDING", tokenJti: jti, tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000), submissionId: null,
    });
    const err: any = new Error("serialization"); err.code = "P2034";
    mocks.prisma.$transaction.mockRejectedValue(err);

    const res = await submitForm(jsonReq("http://x/api/public/forms/slug1/submit", "POST", { answers: [{ fieldId: "fFile", value: { token } }], website: "" }), { params: Promise.resolve({ slug: "slug1" }) } as any);
    expect(res.status).toBe(409);
    expect(deleteFormFileIfUnreferenced).toHaveBeenCalledWith("forms/form1/fFile/test-uuid.txt", "form1", "fFile");
  });
});

describe("durable form upload lifecycle", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-32-chars!!";
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn(mocks.prisma));
  });

  it("enforces shared DB rate limit at boundary", async () => {
    const { registerAndStoreFormUpload, FORM_UPLOAD_RATE_LIMIT } = await import("@/lib/form-uploads");
    mocks.prisma.formUpload.count.mockResolvedValue(FORM_UPLOAD_RATE_LIMIT);
    await expect(registerAndStoreFormUpload({
      formId: "form1", fieldId: "f1", ipHash: "iphash", uploaderUserId: null,
      file: new File(["x"], "a.txt", { type: "text/plain" }),
    })).rejects.toMatchObject({ status: 429 });
  });

  it("counts ATTACHED and DELETE_FAILED reservations in the active rate-limit window", async () => {
    const { registerAndStoreFormUpload, FORM_UPLOAD_RATE_LIMIT } = await import("@/lib/form-uploads");
    mocks.prisma.formUpload.count.mockImplementation(async (args: any) => {
      // Regression: count must not filter by PENDING status; attached/deleted-failed still count.
      expect(args?.where?.status).toBeUndefined();
      expect(args?.where?.formId).toBe("form1");
      expect(args?.where?.ipHash).toBe("iphash");
      expect(args?.where?.createdAt?.gte).toBeInstanceOf(Date);
      return FORM_UPLOAD_RATE_LIMIT;
    });
    await expect(registerAndStoreFormUpload({
      formId: "form1", fieldId: "f1", ipHash: "iphash", uploaderUserId: null,
      file: new File(["x"], "a.txt", { type: "text/plain" }),
    })).rejects.toMatchObject({ status: 429 });
  });

  it("registers upload, stores DB record, and issues token", async () => {
    const { registerAndStoreFormUpload } = await import("@/lib/form-uploads");
    const { verifyFormUploadToken } = await import("@/lib/form-file-storage");
    mocks.prisma.formUpload.count.mockResolvedValue(0);
    mocks.prisma.formUpload.create.mockResolvedValue({ id: "upl1", key: "forms/form1/f1/mock.txt", tokenJti: "jti1" });
    mocks.prisma.formUpload.update.mockResolvedValue({});
    const out = await registerAndStoreFormUpload({
      formId: "form1", fieldId: "f1", ipHash: "iphash", uploaderUserId: "u1",
      file: new File(["hello"], "test.txt", { type: "text/plain" }),
    });
    expect(out.token).toBeTruthy();
    expect(out.key).toContain("forms/form1/f1/");
    const verified = verifyFormUploadToken(out.token, "form1", "f1");
    expect(verified?.key).toBe(out.key);
    expect(mocks.prisma.formUpload.create).toHaveBeenCalled();
  });

  it("attaches upload in submission transaction and rejects reused/invalid attachment", async () => {
    const { attachFormUploadsToSubmission } = await import("@/lib/form-uploads");
    mocks.prisma.formUpload.updateMany.mockResolvedValue({ count: 1 });
    await expect(attachFormUploadsToSubmission(mocks.prisma as any, "form1", "sub1", [{ jti: "j1", key: "forms/form1/f1/a.txt", fieldId: "f1" }])).resolves.toBeUndefined();
    mocks.prisma.formUpload.updateMany.mockResolvedValue({ count: 0 });
    await expect(attachFormUploadsToSubmission(mocks.prisma as any, "form1", "sub1", [{ jti: "j1", key: "forms/form1/f1/a.txt", fieldId: "f1" }])).rejects.toMatchObject({ status: 400 });
  });

  it("cleans expired uploads and retries delete failures safely", async () => {
    const { cleanupExpiredFormUploads } = await import("@/lib/form-uploads");
    const { deleteFormFileIfUnreferenced } = await import("@/lib/form-file-storage");
    mocks.prisma.formUpload.findMany.mockResolvedValue([
      { id: "u1", formId: "form1", fieldId: "f1", key: "forms/form1/f1/a.txt", status: "PENDING", tokenExpiresAt: new Date(Date.now()-1000), createdAt: new Date(Date.now()-3*3600000), attachedAt: null, submissionId: null },
      { id: "u2", formId: "form1", fieldId: "f1", key: "forms/form1/f1/b.txt", status: "DELETE_FAILED", tokenExpiresAt: new Date(Date.now()-1000), createdAt: new Date(Date.now()-3*3600000), attachedAt: null, submissionId: null },
    ]);
    mocks.prisma.formAnswer.findFirst.mockResolvedValue(null);
    mocks.prisma.formUpload.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.formUpload.update.mockResolvedValue({});
    (deleteFormFileIfUnreferenced as any).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await cleanupExpiredFormUploads(10);
    expect(res.scanned).toBe(2);
    expect(res.deleted).toBe(1);
    expect(res.failed).toBe(1);
  });

  it("never deletes referenced files and marks upload attached", async () => {
    const { cleanupExpiredFormUploads } = await import("@/lib/form-uploads");
    const { deleteFormFileIfUnreferenced } = await import("@/lib/form-file-storage");
    mocks.prisma.formUpload.findMany.mockResolvedValue([
      { id: "u1", formId: "form1", fieldId: "f1", key: "forms/form1/f1/a.txt", status: "PENDING", tokenExpiresAt: new Date(Date.now()-1000), createdAt: new Date(Date.now()-3*3600000), attachedAt: null, submissionId: null },
    ]);
    mocks.prisma.formAnswer.findFirst.mockResolvedValue({ id: "ans1", submissionId: "sub1" });
    mocks.prisma.formUpload.update.mockResolvedValue({});
    const res = await cleanupExpiredFormUploads(10);
    expect(res.deleted).toBe(0);
    expect(deleteFormFileIfUnreferenced).not.toHaveBeenCalled();
    expect(mocks.prisma.formUpload.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({ status: "ATTACHED", submissionId: "sub1" }),
    }));
  });

  it("is safe under concurrent cleanup claim race", async () => {
    const { cleanupExpiredFormUploads } = await import("@/lib/form-uploads");
    mocks.prisma.formUpload.findMany.mockResolvedValue([
      { id: "u1", formId: "form1", fieldId: "f1", key: "forms/form1/f1/a.txt", status: "PENDING", tokenExpiresAt: new Date(Date.now()-1000), createdAt: new Date(Date.now()-3*3600000), attachedAt: null, submissionId: null },
    ]);
    mocks.prisma.formAnswer.findFirst.mockResolvedValue(null);
    mocks.prisma.formUpload.updateMany.mockResolvedValue({ count: 0 }); // another worker claimed it
    const res = await cleanupExpiredFormUploads(10);
    expect(res.skipped).toBe(1);
    expect(res.deleted).toBe(0);
  });
});
