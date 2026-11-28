import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrivateStorageConfigError, resolvePrivateBucket } from "@/lib/private-storage";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const FORM_STORAGE_BUCKET = "forms";
const LOCAL_PRIVATE_DIR = path.join(process.cwd(), ".data", "form-uploads");
const SIGNED_URL_TTL_SECONDS = 60 * 5;

export class FormFileUploadError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "FormFileUploadError"; }
}

function getFormBucket(): string {
  try {
    return resolvePrivateBucket({
      configuredValue: process.env.SUPABASE_FORM_STORAGE_BUCKET,
      fallback: FORM_STORAGE_BUCKET,
      kind: "form",
    });
  } catch (error) {
    if (error instanceof PrivateStorageConfigError) throw new FormFileUploadError(error.message, error.status);
    throw new FormFileUploadError("Private form storage bucket configuration is invalid.", 503);
  }
}

type StorageDriver = "local-private" | "supabase-private" | "disabled";

export function getFormStorageDriver(): StorageDriver {
  const configured = (process.env.FORM_STORAGE_DRIVER || process.env.STORAGE_DRIVER || "").trim().toLowerCase();
  if (configured === "supabase") return "supabase-private";
  if (configured === "local") return process.env.NODE_ENV === "production" ? "disabled" : "local-private";
  const hasSupabase = !!process.env.SUPABASE_URL?.trim() && !!(process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (hasSupabase) return "supabase-private";
  return process.env.NODE_ENV === "production" ? "disabled" : "local-private";
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new FormFileUploadError("Private form storage is not configured.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeExt(fileName: string, mime: string) {
  const fromName = path.extname(fileName || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  if (fromName) return fromName;
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "text/plain") return ".txt";
  if (mime === "text/csv") return ".csv";
  if (mime === "application/msword") return ".doc";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (mime === "application/vnd.ms-excel") return ".xls";
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return ".xlsx";
  return "";
}

export function isAllowedFormFileMime(mime: string) { return ALLOWED_MIME.has(mime.toLowerCase()); }
export function maxFormFileBytes() { return MAX_FILE_BYTES; }

export function buildFormFileKey(formId: string, fieldId: string, fileName: string, mime: string) {
  const ext = safeExt(fileName, mime);
  return `forms/${formId}/${fieldId}/${randomUUID()}${ext}`;
}

export function isSafeFormFileKey(key: string, formId: string, fieldId: string) {
  if (typeof key !== "string") return false;
  if (key.length < 10 || key.length > 1024) return false;
  if (key.includes("..") || key.includes("\\") || key.startsWith("/") || key.includes("//")) return false;
  const prefix = `forms/${formId}/${fieldId}/`;
  if (!key.startsWith(prefix)) return false;
  // only allow safe chars in remainder
  const rest = key.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(rest);
}

function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip-office"; // docx/xlsx are zip
  return null;
}

export async function uploadFormFile(file: File, formId: string, fieldId: string, precomputedKey?: string): Promise<{ key: string; fileName: string; fileSize: number; fileMime: string }> {
  if (!(file instanceof File) || file.size <= 0) throw new FormFileUploadError("Choose a file to upload.", 400);
  if (file.size > MAX_FILE_BYTES) throw new FormFileUploadError("File is too large. Maximum size is 10 MB.", 400);
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) throw new FormFileUploadError("File type is not allowed.", 400);
  const key = precomputedKey && isSafeFormFileKey(precomputedKey, formId, fieldId)
    ? precomputedKey
    : buildFormFileKey(formId, fieldId, file.name || "", mime);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(bytes);
  if (sniffed) {
    if (sniffed === "zip-office") {
      if (![ "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ].includes(mime)) {
        throw new FormFileUploadError("File content does not match allowed type.", 400);
      }
    } else if (sniffed !== mime) {
      throw new FormFileUploadError("File content does not match allowed type.", 400);
    }
  }
  const driver = getFormStorageDriver();
  if (driver === "disabled") {
    throw new FormFileUploadError("File uploads are currently unavailable.", 503);
  }
  if (driver === "supabase-private") {
    const supabase = getSupabaseAdmin();
    const bucket = getFormBucket();
    const { error } = await supabase.storage.from(bucket).upload(key, bytes, { contentType: mime, upsert: false });
    if (error) throw new FormFileUploadError("Could not upload file.", 500);
  } else {
    // local-private: outside web root, never public
    const dest = path.join(LOCAL_PRIVATE_DIR, key.replaceAll("/", path.sep));
    const resolved = path.resolve(dest);
    const base = path.resolve(LOCAL_PRIVATE_DIR);
    if (!resolved.startsWith(base + path.sep)) throw new FormFileUploadError("Invalid file path.", 400);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, bytes);
  }
  return { key, fileName: (file.name || `upload${safeExt(file.name || "", mime)}`).slice(0, 255), fileSize: file.size, fileMime: mime };
}

export async function createSignedFormFileUrl(key: string): Promise<{ url: string; expiresIn: number }> {
  const driver = getFormStorageDriver();
  if (driver === "supabase-private") {
    const supabase = getSupabaseAdmin();
    const bucket = getFormBucket();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new FormFileUploadError("Could not create download link.", 500);
    return { url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS };
  }
  if (driver === "local-private") {
    // Local dev: return an internal authorized download path token is not needed here; route will stream file after auth.
    // The caller should use the local streaming endpoint instead of this URL. We signal with a special scheme.
    return { url: `/api/forms/files/local?key=${encodeURIComponent(key)}`, expiresIn: SIGNED_URL_TTL_SECONDS };
  }
  throw new FormFileUploadError("File downloads are currently unavailable.", 503);
}

export async function readLocalPrivateFormFile(key: string): Promise<Buffer> {
  if (getFormStorageDriver() !== "local-private") throw new FormFileUploadError("Local file storage is not enabled.", 503);
  const dest = path.join(LOCAL_PRIVATE_DIR, key.replaceAll("/", path.sep));
  const resolved = path.resolve(dest);
  const base = path.resolve(LOCAL_PRIVATE_DIR);
  if (!resolved.startsWith(base + path.sep)) throw new FormFileUploadError("Invalid file path.", 400);
  return readFile(resolved);
}

export async function deleteFormFileIfUnreferenced(key: string, formId: string, fieldId: string): Promise<boolean> {
  if (!isSafeFormFileKey(key, formId, fieldId)) return false;
  // Safety: only delete when no DB answer references the key.
  const { prisma } = await import("@/lib/prisma");
  const referenced = await prisma.formAnswer.findFirst({ where: { fileKey: key }, select: { id: true } });
  if (referenced) return false;
  const driver = getFormStorageDriver();
  try {
    if (driver === "supabase-private") {
      const supabase = getSupabaseAdmin();
      const bucket = getFormBucket();
      const { error } = await supabase.storage.from(bucket).remove([key]);
      return !error;
    }
    if (driver === "local-private") {
      const dest = path.join(LOCAL_PRIVATE_DIR, key.replaceAll("/", path.sep));
      const resolved = path.resolve(dest);
      const base = path.resolve(LOCAL_PRIVATE_DIR);
      if (!resolved.startsWith(base + path.sep)) return false;
      await rm(resolved, { force: true });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getFormStorageConfigSummary() {
  const driver = getFormStorageDriver();
  let bucket = FORM_STORAGE_BUCKET;
  let bucketValid = true;
  try {
    bucket = getFormBucket();
  } catch {
    bucketValid = false;
    bucket = FORM_STORAGE_BUCKET;
  }
  return {
    driver,
    bucket,
    hasSupabaseUrl: !!process.env.SUPABASE_URL?.trim(),
    hasSupabaseKey: !!(process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    private: driver !== "disabled" && bucketValid,
  };
}

function getSigningSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new FormFileUploadError("Server configuration error.", 500);
  return secret;
}

function getTokenKey() {
  return createHash("sha256").update(`form-upload-token:${getSigningSecret()}`).digest();
}

const usedUploadTokens = new Map<string, number>(); // jti -> exp
function markUploadTokenUsed(jti: string, exp: number) {
  const now = Date.now();
  for (const [k, v] of usedUploadTokens) { if (v <= now) usedUploadTokens.delete(k); }
  if (usedUploadTokens.has(jti)) return false;
  usedUploadTokens.set(jti, exp);
  return true;
}

export function signFormUploadToken(payload: { key: string; formId: string; fieldId: string; fileName: string; fileSize: number; fileMime: string; jti?: string; exp?: number }) {
  const exp = typeof payload.exp === "number" ? payload.exp : Date.now() + 30 * 60 * 1000; // 30 min default
  const jti = typeof payload.jti === "string" && payload.jti.length >= 10 ? payload.jti : randomUUID();
  const iv = randomBytes(12);
  const key = getTokenKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify({
    key: payload.key,
    formId: payload.formId,
    fieldId: payload.fieldId,
    fileName: payload.fileName,
    fileSize: payload.fileSize,
    fileMime: payload.fileMime,
    exp,
    jti,
  }), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // token = iv.tag.ciphertext (all base64url)
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function verifyFormUploadToken(token: string, formId: string, fieldId: string, opts?: { consume?: boolean }): { key: string; fileName: string; fileSize: number; fileMime: string; jti: string; exp: number } | null {
  try {
    const [ivB64, tagB64, dataB64] = String(token || "").split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || data.length < 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", getTokenKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext);
    if (!payload || payload.formId !== formId || payload.fieldId !== fieldId) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.jti !== "string" || payload.jti.length < 10) return null;
    if (!isSafeFormFileKey(payload.key, formId, fieldId)) return null;
    if (typeof payload.fileName !== "string" || typeof payload.fileMime !== "string" || typeof payload.fileSize !== "number") return null;
    if (opts?.consume && !markUploadTokenUsed(payload.jti, payload.exp)) return null;
    return { key: payload.key, fileName: payload.fileName.slice(0, 255), fileSize: payload.fileSize, fileMime: payload.fileMime.slice(0, 255), jti: payload.jti, exp: payload.exp };
  } catch { return null; }
}
