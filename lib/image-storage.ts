import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const maxBytes = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ImageUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ImageUploadError";
  }
}

export function getStorageDriver() {
  const configured = (process.env.STORAGE_DRIVER || "").trim().toLowerCase();
  if (configured === "local" || configured === "supabase" || configured === "cloudinary") return configured;
  return process.env.NODE_ENV === "production" ? "cloudinary" : "local";
}

async function optimizeImage(file: File) {
  if (!allowedTypes.has(file.type) || file.size > maxBytes || file.size === 0) {
    throw new ImageUploadError("Use a JPG, PNG, or WebP image smaller than 5 MB.", 400);
  }
  const source = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(source, { limitInputPixels: 24_000_000 }).metadata().catch(() => null);
  if (!metadata || !metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
    throw new ImageUploadError("That image could not be decoded.", 400);
  }
  try {
    return await sharp(source, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize(800, 800, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ImageUploadError("Could not process that photo.", 400);
  }
}

async function uploadLocal(optimized: Buffer, folder: string, ownerId: string) {
  const relativeDir = path.join("uploads", folder, ownerId);
  const absoluteDir = path.join(process.cwd(), "public", relativeDir);
  const fileName = `${randomUUID()}.webp`;
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, fileName), optimized);
  return `/${relativeDir.split(path.sep).join("/")}/${fileName}`;
}

async function uploadSupabase(optimized: Buffer, folder: string, ownerId: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) throw new ImageUploadError("Supabase image storage is not configured.", 503);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "club-assets";
  const storage = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }).storage.from(bucket);
  const objectPath = `${folder}/${ownerId}/${randomUUID()}.webp`;
  const { error } = await storage.upload(objectPath, optimized, { contentType: "image/webp", upsert: false });
  if (error) {
    console.error("[Image upload] Supabase upload failed", error.message);
    throw new ImageUploadError("Photo upload failed.", 502);
  }
  return storage.getPublicUrl(objectPath).data.publicUrl;
}

function cloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

async function uploadCloudinary(optimized: Buffer, folder: string, ownerId: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new ImageUploadError("Cloudinary image storage is not configured.", 503);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = `${folder}/${ownerId}/${randomUUID()}`;
  const signature = cloudinarySignature({ folder: `${folder}/${ownerId}`, public_id: publicId, timestamp }, apiSecret);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(optimized)], { type: "image/webp" }), "image.webp");
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("public_id", publicId);
  form.append("folder", `${folder}/${ownerId}`);
  form.append("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
  const result = await response.json().catch(() => ({} as { secure_url?: string; error?: { message?: string } }));
  if (!response.ok || !result.secure_url) {
    console.error("[Image upload] Cloudinary upload failed", result.error?.message ?? response.statusText);
    throw new ImageUploadError("Photo upload failed.", 502);
  }
  return result.secure_url;
}

export async function uploadClubImage(file: File, folder: string, ownerId: string) {
  const optimized = await optimizeImage(file);
  const driver = getStorageDriver();
  if (driver === "local") return uploadLocal(optimized, folder, ownerId);
  if (driver === "supabase") return uploadSupabase(optimized, folder, ownerId);
  return uploadCloudinary(optimized, folder, ownerId);
}
