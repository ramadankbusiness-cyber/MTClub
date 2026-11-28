import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrivateStorageConfigError, resolvePrivateBucket } from "@/lib/private-storage";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
export const CERTIFICATE_STORAGE_BUCKET = "certificates";
const LOCAL_PRIVATE_DIR = path.join(process.cwd(), ".data", "certificate-files");
const SIGNED_URL_TTL_SECONDS = 60 * 5;

export class CertificateStorageError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "CertificateStorageError"; }
}

function getCertificateBucket(): string {
  try {
    return resolvePrivateBucket({
      configuredValue: process.env.SUPABASE_CERTIFICATE_STORAGE_BUCKET,
      fallback: CERTIFICATE_STORAGE_BUCKET,
      kind: "certificate",
    });
  } catch (error) {
    if (error instanceof PrivateStorageConfigError) throw new CertificateStorageError(error.message, error.status);
    throw new CertificateStorageError("Private certificate storage bucket configuration is invalid.", 503);
  }
}

type StorageDriver = "local-private" | "supabase-private" | "disabled";

export function getCertificateStorageDriver(): StorageDriver {
  const configured = (process.env.CERTIFICATE_STORAGE_DRIVER || process.env.FORM_STORAGE_DRIVER || process.env.STORAGE_DRIVER || "").trim().toLowerCase();
  if (configured === "supabase") return "supabase-private";
  if (configured === "local") return process.env.NODE_ENV === "production" ? "disabled" : "local-private";
  const hasSupabase = !!process.env.SUPABASE_URL?.trim() && !!(process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (hasSupabase) return "supabase-private";
  return process.env.NODE_ENV === "production" ? "disabled" : "local-private";
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new CertificateStorageError("Private certificate storage is not configured.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeExt(fileName: string, mime: string) {
  const fromName = path.extname(fileName || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  if (fromName) return fromName;
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return "";
}

export function isAllowedCertificateMime(mime: string) { return ALLOWED_MIME.has(mime.toLowerCase()); }
export function maxCertificateFileBytes() { return MAX_FILE_BYTES; }

export function buildCertificateFileKey(userId: string, fileName: string, mime: string) {
  const ext = safeExt(fileName, mime);
  return `certificates/${userId}/${randomUUID()}${ext}`;
}

export function isSafeCertificateFileKey(key: string) {
  if (typeof key !== "string" || key.length < 10 || key.length > 1024) return false;
  if (key.includes("..") || key.includes("\\") || key.startsWith("/") || key.includes("//")) return false;
  if (!key.startsWith("certificates/")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(key);
}

function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function uploadCertificateFile(file: File, userId: string): Promise<{ key: string; fileName: string; fileSize: number; fileMime: string }> {
  if (!(file instanceof File) || file.size <= 0) throw new CertificateStorageError("Choose a file to upload.", 400);
  if (file.size > MAX_FILE_BYTES) throw new CertificateStorageError("File is too large. Maximum size is 15 MB.", 400);
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) throw new CertificateStorageError("File type is not allowed. Use PDF or image.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(bytes);
  if (sniffed && sniffed !== mime) throw new CertificateStorageError("File content does not match allowed type.", 400);
  const key = buildCertificateFileKey(userId, (file.name || "").slice(0, 200), mime);

  const driver = getCertificateStorageDriver();
  if (driver === "disabled") throw new CertificateStorageError("Certificate storage is currently unavailable.", 503);
  if (driver === "supabase-private") {
    const supabase = getSupabaseAdmin();
    const bucket = getCertificateBucket();
    const { error } = await supabase.storage.from(bucket).upload(key, bytes, { contentType: mime, upsert: false });
    if (error) throw new CertificateStorageError("Could not upload certificate file.", 500);
  } else {
    const dest = path.join(LOCAL_PRIVATE_DIR, key.replaceAll("/", path.sep));
    const resolved = path.resolve(dest);
    const base = path.resolve(LOCAL_PRIVATE_DIR);
    if (!resolved.startsWith(base + path.sep)) throw new CertificateStorageError("Invalid file path.", 400);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, bytes);
  }
  return { key, fileName: (file.name || `certificate${safeExt(file.name || "", mime)}`).slice(0, 255), fileSize: file.size, fileMime: mime };
}

export async function createSignedCertificateFileUrl(key: string): Promise<{ url: string; expiresIn: number }> {
  const driver = getCertificateStorageDriver();
  if (driver === "supabase-private") {
    const supabase = getSupabaseAdmin();
    const bucket = getCertificateBucket();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new CertificateStorageError("Could not create download link.", 500);
    return { url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS };
  }
  if (driver === "local-private") {
    return { url: `/api/certificates/files/local?key=${encodeURIComponent(key)}`, expiresIn: SIGNED_URL_TTL_SECONDS };
  }
  throw new CertificateStorageError("Certificate downloads are currently unavailable.", 503);
}

export async function readLocalPrivateCertificateFile(key: string): Promise<Buffer> {
  if (getCertificateStorageDriver() !== "local-private") throw new CertificateStorageError("Local file storage is not enabled.", 503);
  const dest = path.join(LOCAL_PRIVATE_DIR, key.replaceAll("/", path.sep));
  const resolved = path.resolve(dest);
  const base = path.resolve(LOCAL_PRIVATE_DIR);
  if (!resolved.startsWith(base + path.sep)) throw new CertificateStorageError("Invalid file path.", 400);
  return readFile(resolved);
}

export function getCertificateStorageConfigSummary() {
  const driver = getCertificateStorageDriver();
  let bucket = CERTIFICATE_STORAGE_BUCKET;
  let bucketValid = true;
  try {
    bucket = getCertificateBucket();
  } catch {
    bucketValid = false;
    bucket = CERTIFICATE_STORAGE_BUCKET;
  }
  return {
    driver,
    bucket,
    hasSupabaseUrl: !!process.env.SUPABASE_URL?.trim(),
    hasSupabaseKey: !!(process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    private: driver !== "disabled" && bucketValid,
  };
}
