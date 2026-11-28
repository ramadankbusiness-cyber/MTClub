import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { isSafeCertificateFileKey, readLocalPrivateCertificateFile, CertificateStorageError } from "@/lib/certificate-storage";

async function GETInternal(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!isSafeCertificateFileKey(key)) return NextResponse.json({ error: "Invalid file." }, { status: 400 });

  const cert = await prisma.certificate.findFirst({
    where: { fileKey: key },
    select: { id: true, userId: true, fileName: true, fileMime: true },
  });
  if (!cert) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const isOwner = cert.userId === user.id;
  const canReadAll = hasPermission(user, "certificates.read.all");
  if (!isOwner && !canReadAll) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const bytes = await readLocalPrivateCertificateFile(key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": cert.fileMime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${cert.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof CertificateStorageError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export const GET = withApiErrorHandling(GETInternal, "/api/certificates/files/local");
