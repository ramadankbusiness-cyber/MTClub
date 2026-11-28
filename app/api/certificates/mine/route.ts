import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";

async function GETInternal() {
  const access = await requirePermission("certificates.read.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const certificates = await prisma.certificate.findMany({
    where: { userId: access.user.id },
    orderBy: { issueDate: "desc" },
    select: {
      id: true, certificateCode: true, title: true, titleAr: true, issuerName: true, issuerNameAr: true,
      issueDate: true, fileName: true, fileMime: true, fileSize: true, createdAt: true,
    },
  });
  return NextResponse.json({ certificates });
}

export const GET = withApiErrorHandling(GETInternal, "/api/certificates/mine");
