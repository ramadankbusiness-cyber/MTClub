import { randomUUID } from "node:crypto";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { deleteFormFileIfUnreferenced, FormFileUploadError, signFormUploadToken, uploadFormFile, verifyFormUploadToken } from "@/lib/form-file-storage";

export const FORM_UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;
export const FORM_UPLOAD_RATE_LIMIT = 15;
export const FORM_UPLOAD_RATE_WINDOW_MS = 15 * 60 * 1000;
export const FORM_UPLOAD_ABANDONED_MS = 2 * 60 * 60 * 1000; // eligible for cleanup after 2h if still pending

export type PendingFormUpload = {
  id: string;
  key: string;
  formId: string;
  fieldId: string;
  fileName: string;
  fileSize: number;
  fileMime: string;
  tokenJti: string;
  tokenExpiresAt: Date;
};

function uploadRateLockKey(formId: string, ipHash: string) {
  return `form-upload:${formId}:${ipHash}`;
}

async function lockUploadRate(tx: Prisma.TransactionClient, formId: string, ipHash: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uploadRateLockKey(formId, ipHash)}))`;
}

export async function registerAndStoreFormUpload(params: {
  formId: string;
  fieldId: string;
  ipHash: string | null;
  uploaderUserId: string | null;
  file: File;
}): Promise<{ token: string; fileName: string; fileSize: number; fileMime: string; key: string; expiresAt: Date }> {
  const { formId, fieldId, ipHash, uploaderUserId, file } = params;
  const now = new Date();
  const windowStart = new Date(now.getTime() - FORM_UPLOAD_RATE_WINDOW_MS);
  const expiresAt = new Date(now.getTime() + FORM_UPLOAD_TOKEN_TTL_MS);
  const tokenJti = randomUUID();

  // Pre-validate file and reserve DB slot atomically to enforce cross-instance limit.
  if (!(file instanceof File) || file.size <= 0) throw new FormFileUploadError("Choose a file to upload.", 400);
  const reserved = await prisma.$transaction(async (tx) => {
    if (ipHash) {
      await lockUploadRate(tx, formId, ipHash);
      const count = await tx.formUpload.count({
        where: { formId, ipHash, createdAt: { gte: windowStart } },
      });
      if (count >= FORM_UPLOAD_RATE_LIMIT) {
        throw new FormFileUploadError("Too many attempts. Please try again later.", 429);
      }
    }
    const { buildFormFileKey } = await import("@/lib/form-file-storage");
    const key = buildFormFileKey(formId, fieldId, file.name || "", (file.type || "application/octet-stream").toLowerCase());
    const row = await tx.formUpload.create({
      data: {
        formId,
        fieldId,
        key,
        fileName: (file.name || "upload").slice(0, 255),
        fileSize: file.size,
        fileMime: (file.type || "application/octet-stream").toLowerCase().slice(0, 255),
        uploaderUserId,
        ipHash,
        tokenJti,
        tokenExpiresAt: expiresAt,
        status: "PENDING",
      },
      select: { id: true, key: true, tokenJti: true },
    });
    return row;
  });

  try {
    const stored = await uploadFormFile(file, formId, fieldId, reserved.key);
    await prisma.formUpload.update({
      where: { id: reserved.id },
      data: { fileName: stored.fileName, fileSize: stored.fileSize, fileMime: stored.fileMime, key: stored.key },
    }).catch(() => undefined);

    let token: string;
    try {
      token = signFormUploadToken({ ...stored, formId, fieldId, jti: tokenJti, exp: expiresAt.getTime() });
    } catch (err) {
      await markUploadDeleteFailed(tokenJti, err instanceof Error ? err.message : "token_issue_failed").catch(() => undefined);
      await deleteFormFileIfUnreferenced(stored.key, formId, fieldId).catch(() => undefined);
      throw err;
    }

    return { token, fileName: stored.fileName, fileSize: stored.fileSize, fileMime: stored.fileMime, key: stored.key, expiresAt };
  } catch (err) {
    await markUploadDeleteFailed(tokenJti, err instanceof Error ? err.message : "upload_failed").catch(() => undefined);
    await deleteFormFileIfUnreferenced(reserved.key, formId, fieldId).catch(() => undefined);
    throw err;
  }
}

export async function verifyAndConsumePendingFormUpload(token: string, formId: string, fieldId: string) {
  const verified = verifyFormUploadToken(token, formId, fieldId, { consume: false });
  if (!verified) return null;
  const jti = (verified as any).jti as string | undefined;
  if (!jti) return null;
  const now = new Date();
  const record = await prisma.formUpload.findUnique({ where: { tokenJti: jti } });
  if (!record) return null;
  if (record.formId !== formId || record.fieldId !== fieldId || record.key !== verified.key) return null;
  if (record.status !== "PENDING") return null;
  if (record.tokenExpiresAt.getTime() <= now.getTime()) return null;
  return { ...verified, jti, uploadId: record.id };
}

export async function attachFormUploadsToSubmission(
  tx: Prisma.TransactionClient,
  formId: string,
  submissionId: string,
  uploads: Array<{ jti: string; key: string; fieldId: string }>
) {
  const now = new Date();
  for (const u of uploads) {
    const updated = await tx.formUpload.updateMany({
      where: {
        tokenJti: u.jti,
        formId,
        fieldId: u.fieldId,
        key: u.key,
        status: "PENDING",
        tokenExpiresAt: { gt: now },
      },
      data: { status: "ATTACHED", submissionId, attachedAt: now },
    });
    if (updated.count !== 1) {
      throw new FormFileUploadError("Uploaded file is no longer valid. Please upload again.", 400);
    }
  }
}

export async function markUploadDeleteFailed(tokenJti: string, message: string) {
  await prisma.formUpload.updateMany({
    where: { tokenJti, status: { in: ["PENDING", "DELETE_FAILED"] } },
    data: { status: "DELETE_FAILED", deleteAttempts: { increment: 1 }, lastDeleteError: message.slice(0, 500) },
  });
}

export async function cleanupExpiredFormUploads(limit = 50) {
  const now = new Date();
  const abandonedBefore = new Date(now.getTime() - FORM_UPLOAD_ABANDONED_MS);
  const candidates = await prisma.formUpload.findMany({
    where: {
      status: { in: ["PENDING", "DELETE_FAILED", "EXPIRED"] },
      OR: [
        { tokenExpiresAt: { lte: now } },
        { createdAt: { lte: abandonedBefore } },
        { status: "EXPIRED" }, // retry stuck claims
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  for (const u of candidates) {
    // Never delete if referenced by persisted FormAnswer
    const answerRef = await prisma.formAnswer.findFirst({ where: { fileKey: u.key }, select: { id: true, submissionId: true } });
    if (answerRef) {
      await prisma.formUpload.update({
        where: { id: u.id },
        data: { status: "ATTACHED", attachedAt: u.attachedAt ?? now, submissionId: u.submissionId ?? answerRef.submissionId },
      }).catch(() => undefined);
      skipped++;
      continue;
    }
    // Claim for deletion by transitioning state; idempotent under concurrency
    const claimed = await prisma.formUpload.updateMany({
      where: { id: u.id, status: { in: ["PENDING", "DELETE_FAILED", "EXPIRED"] } },
      data: { status: "EXPIRED", lastDeleteError: u.lastDeleteError ?? null },
    });
    if (claimed.count !== 1) { skipped++; continue; }

    const ok = await deleteFormFileIfUnreferenced(u.key, u.formId, u.fieldId).catch(() => false);
    if (ok) {
      await prisma.formUpload.update({ where: { id: u.id }, data: { status: "DELETED", deletedAt: new Date(), lastDeleteError: null } }).catch(() => undefined);
      deleted++;
    } else {
      await prisma.formUpload.update({
        where: { id: u.id },
        data: { status: "DELETE_FAILED", deleteAttempts: { increment: 1 }, lastDeleteError: "storage_delete_failed" },
      }).catch(() => undefined);
      failed++;
    }
  }
  return { scanned: candidates.length, deleted, skipped, failed };
}
