import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { createSignedCertificateFileUrl, getCertificateStorageDriver, isSafeCertificateFileKey, readLocalPrivateCertificateFile, CertificateStorageError } from "@/lib/certificate-storage";

type RouteContext = { params: Promise<{ id: string }> };

async function GETInternal(_request: Request, context: RouteContext) {
  const user = await requireUser();
  const { id } = await context.params;
  const cert = await prisma.certificate.findUnique({
    where: { id },
    select: { id: true, userId: true, fileKey: true, fileName: true, fileMime: true },
  });
  if (!cert) return NextResponse.json({ error: "Certificate not found." }, { status: 404 });

  const isOwner = cert.userId === user.id;
  const canReadAll = hasPermission(user, "certificates.read.all");
  if (!isOwner && !canReadAll) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isSafeCertificateFileKey(cert.fileKey)) return NextResponse.json({ error: "Invalid certificate file." }, { status: 400 });

  try {
    const driver = getCertificateStorageDriver();
    if (driver === "local-private") {
      const bytes = await readLocalPrivateCertificateFile(cert.fileKey);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": cert.fileMime || "application/octet-stream",
          "Content-Disposition": `inline; filename="${cert.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const signed = await createSignedCertificateFileUrl(cert.fileKey);
    return NextResponse.json({ url: signed.url, expiresIn: signed.expiresIn, fileName: cert.fileName });
  } catch (e) {
    if (e instanceof CertificateStorageError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export const GET = withApiErrorHandling(GETInternal, "/api/certificates/[id]/download");
