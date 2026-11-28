import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUrlMock = vi.fn(async () => ({ data: { signedUrl: "https://example.supabase.co/signed/private" }, error: null }));
const uploadMock = vi.fn(async () => ({ error: null }));
const fromMock = vi.fn(() => ({ createSignedUrl: createSignedUrlMock, upload: uploadMock }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ storage: { from: fromMock } })),
}));

const ORIGINAL_ENV = { ...process.env };

function setBaseSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret-key";
  process.env.NODE_ENV = "production";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.FORM_STORAGE_DRIVER;
  delete process.env.CERTIFICATE_STORAGE_DRIVER;
  delete process.env.STORAGE_DRIVER;
  delete process.env.SUPABASE_FORM_STORAGE_BUCKET;
  delete process.env.SUPABASE_CERTIFICATE_STORAGE_BUCKET;
}

async function loadFormStorage() {
  vi.resetModules();
  return import("@/lib/form-file-storage");
}

async function loadCertificateStorage() {
  vi.resetModules();
  return import("@/lib/certificate-storage");
}

describe("private storage hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    setBaseSupabaseEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects club-assets for forms (uploads, signed URLs, config)", async () => {
    process.env.SUPABASE_FORM_STORAGE_BUCKET = "club-assets";
    const mod = await loadFormStorage();
    const file = new File([Buffer.from("%PDF-1.4 test")], "test.pdf", { type: "application/pdf" });

    await expect(mod.uploadFormFile(file, "form1", "field1")).rejects.toMatchObject({
      name: "FormFileUploadError",
      status: 503,
    });
    await expect(mod.createSignedFormFileUrl("forms/form1/field1/file.pdf")).rejects.toMatchObject({
      name: "FormFileUploadError",
      status: 503,
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    const summary = mod.getFormStorageConfigSummary();
    expect(summary.private).toBe(false);
    expect(summary.bucket).toBe("forms");
  });

  it("rejects club-assets for certificates (uploads, signed URLs, config)", async () => {
    process.env.SUPABASE_CERTIFICATE_STORAGE_BUCKET = "club-assets";
    const mod = await loadCertificateStorage();
    const file = new File([Buffer.from("%PDF-1.4 test")], "cert.pdf", { type: "application/pdf" });

    await expect(mod.uploadCertificateFile(file, "user1")).rejects.toMatchObject({
      name: "CertificateStorageError",
      status: 503,
    });
    await expect(mod.createSignedCertificateFileUrl("certificates/user1/file.pdf")).rejects.toMatchObject({
      name: "CertificateStorageError",
      status: 503,
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    const summary = mod.getCertificateStorageConfigSummary();
    expect(summary.private).toBe(false);
    expect(summary.bucket).toBe("certificates");
  });

  it("rejects case variations and malformed bucket names", async () => {
    const badBuckets = ["Club-Assets", "CLUB-ASSETS", " club-assets ", "", "   ", "bad/bucket", "bad bucket", "a", "x".repeat(64)];
    for (const bad of badBuckets) {
      process.env = { ...ORIGINAL_ENV };
      setBaseSupabaseEnv();
      process.env.SUPABASE_FORM_STORAGE_BUCKET = bad;
      process.env.SUPABASE_CERTIFICATE_STORAGE_BUCKET = bad;
      const form = await loadFormStorage();
      const cert = await loadCertificateStorage();
      await expect(form.createSignedFormFileUrl("forms/f1/field1/file.pdf")).rejects.toMatchObject({ status: 503 });
      await expect(cert.createSignedCertificateFileUrl("certificates/u1/file.pdf")).rejects.toMatchObject({ status: 503 });
    }
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("fails closed in production when supabase configuration is missing", async () => {
    process.env = { ...ORIGINAL_ENV };
    process.env.NODE_ENV = "production";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.FORM_STORAGE_DRIVER;
    delete process.env.CERTIFICATE_STORAGE_DRIVER;
    delete process.env.STORAGE_DRIVER;

    const form = await loadFormStorage();
    const cert = await loadCertificateStorage();
    const formFile = new File([Buffer.from("%PDF-1.4 test")], "test.pdf", { type: "application/pdf" });
    const certFile = new File([Buffer.from("%PDF-1.4 test")], "cert.pdf", { type: "application/pdf" });

    await expect(form.uploadFormFile(formFile, "form1", "field1")).rejects.toMatchObject({ status: 503 });
    await expect(form.createSignedFormFileUrl("forms/form1/field1/file.pdf")).rejects.toMatchObject({ status: 503 });
    await expect(cert.uploadCertificateFile(certFile, "user1")).rejects.toMatchObject({ status: 503 });
    await expect(cert.createSignedCertificateFileUrl("certificates/user1/file.pdf")).rejects.toMatchObject({ status: 503 });

    expect(form.getFormStorageDriver()).toBe("disabled");
    expect(cert.getCertificateStorageDriver()).toBe("disabled");
  });

  it("allows valid private bucket names and creates signed URLs/downloads", async () => {
    process.env.SUPABASE_FORM_STORAGE_BUCKET = "forms-private";
    process.env.SUPABASE_CERTIFICATE_STORAGE_BUCKET = "certificates_private.v2";
    const form = await loadFormStorage();
    const cert = await loadCertificateStorage();

    const formSigned = await form.createSignedFormFileUrl("forms/f1/field1/file.pdf");
    const certSigned = await cert.createSignedCertificateFileUrl("certificates/u1/file.pdf");

    expect(formSigned.url).toContain("https://");
    expect(certSigned.url).toContain("https://");
    expect(createSignedUrlMock).toHaveBeenCalledTimes(2);
    expect(fromMock).toHaveBeenCalledWith("forms-private");
    expect(fromMock).toHaveBeenCalledWith("certificates_private.v2");
  });

  it("does not fall back to public bucket when private bucket config is invalid", async () => {
    process.env.SUPABASE_FORM_STORAGE_BUCKET = "club-assets";
    const form = await loadFormStorage();
    await expect(form.createSignedFormFileUrl("forms/f1/field1/file.pdf")).rejects.toMatchObject({ status: 503 });
    expect(fromMock).not.toHaveBeenCalledWith("club-assets");
    expect(fromMock).not.toHaveBeenCalledWith("forms");
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});
