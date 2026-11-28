import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { uploadCertificateFile, CertificateStorageError } from "@/lib/certificate-storage";
import { writeAuditLog } from "@/lib/audit";
import { createHash, randomUUID } from "node:crypto";

const issueSchema = z.object({
  userId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().max(200).optional().nullable(),
  issuerName: z.string().trim().min(1).max(200),
  issuerNameAr: z.string().trim().max(200).optional().nullable(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

function makeCertificateCode() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const rand = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `MT-CERT-${y}-${rand}`;
}

async function GETInternal(request: Request) {
  const access = await requirePermission("certificates.read.all");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));
  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { certificateCode: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { email: { contains: q, mode: "insensitive" } } },
    ];
  }
  const certificates = await prisma.certificate.findMany({
    where,
    take,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } }, issuedBy: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ certificates });
}

async function POSTInternal(request: Request) {
  const access = await requirePermission("certificates.issue");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });

  const raw = {
    userId: String(form.get("userId") || ""),
    title: String(form.get("title") || ""),
    titleAr: form.get("titleAr") ? String(form.get("titleAr")) : null,
    issuerName: String(form.get("issuerName") || ""),
    issuerNameAr: form.get("issuerNameAr") ? String(form.get("issuerNameAr")) : null,
    issueDate: String(form.get("issueDate") || ""),
    idempotencyKey: form.get("idempotencyKey") ? String(form.get("idempotencyKey")) : undefined,
  };
  const parsed = issueSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid certificate data." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Certificate file is required." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, isActive: true, name: true } });
  if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const requestHash = createHash("sha256").update(JSON.stringify({
    userId: target.id,
    title: parsed.data.title,
    titleAr: parsed.data.titleAr || null,
    issuerName: parsed.data.issuerName,
    issuerNameAr: parsed.data.issuerNameAr || null,
    issueDate: parsed.data.issueDate,
    fileName: file.name || "",
    fileSize: file.size,
    fileMime: file.type || "",
    fileHash,
  })).digest("hex");

  const idempotencyKey = parsed.data.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await prisma.certificate.findUnique({
      where: { issuedById_issuanceIdempotencyKey: { issuedById: access.user.id, issuanceIdempotencyKey: idempotencyKey } },
      include: { user: { select: { id: true, name: true, email: true } }, issuedBy: { select: { id: true, name: true } } },
    });
    if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash) {
        return NextResponse.json({ error: "Idempotency key was already used with a different certificate request." }, { status: 409 });
      }
      return NextResponse.json({ certificate: existing, idempotent: true }, { status: 200 });
    }
  }

  let uploaded: { key: string; fileName: string; fileSize: number; fileMime: string };
  try {
    uploaded = await uploadCertificateFile(new File([bytes], file.name, { type: file.type }), target.id);
  } catch (e) {
    if (e instanceof CertificateStorageError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  try {
    const cert = await prisma.certificate.create({
      data: {
        certificateCode: makeCertificateCode(),
        userId: target.id,
        issuedById: access.user.id,
        issuanceIdempotencyKey: idempotencyKey,
        requestHash,
        title: parsed.data.title,
        titleAr: parsed.data.titleAr || null,
        issuerName: parsed.data.issuerName,
        issuerNameAr: parsed.data.issuerNameAr || null,
        issueDate: new Date(parsed.data.issueDate + "T00:00:00.000Z"),
        fileKey: uploaded.key,
        fileName: uploaded.fileName,
        fileMime: uploaded.fileMime,
        fileSize: uploaded.fileSize,
      },
      include: { user: { select: { id: true, name: true, email: true } }, issuedBy: { select: { id: true, name: true } } },
    });

    await writeAuditLog({
      actorId: access.user.id,
      action: "certificate.issue",
      targetType: "Certificate",
      targetId: cert.id,
      details: { userId: cert.userId, certificateCode: cert.certificateCode, title: cert.title },
    }).catch(() => {});

    return NextResponse.json({ certificate: cert, idempotent: false }, { status: 201 });
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "P2002" && idempotencyKey) {
      const existing = await prisma.certificate.findUnique({
        where: { issuedById_issuanceIdempotencyKey: { issuedById: access.user.id, issuanceIdempotencyKey: idempotencyKey } },
        include: { user: { select: { id: true, name: true, email: true } }, issuedBy: { select: { id: true, name: true } } },
      });
      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) {
          return NextResponse.json({ error: "Idempotency key was already used with a different certificate request." }, { status: 409 });
        }
        return NextResponse.json({ certificate: existing, idempotent: true }, { status: 200 });
      }
    }
    throw e;
  }
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/certificates");
export const POST = withApiErrorHandling(POSTInternal, "/api/admin/certificates");
