import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canViewFormResponses } from "@/lib/forms";
import { createSignedFormFileUrl, getFormStorageDriver, isSafeFormFileKey, readLocalPrivateFormFile } from "@/lib/form-file-storage";

type RouteContext = { params: Promise<{ id: string; submissionId: string }> };

async function GETInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("forms.responses.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id, submissionId } = await context.params;
  const url = new URL(request.url);
  const fieldId = url.searchParams.get("fieldId")?.trim() || "";
  if (!fieldId) return NextResponse.json({ error: "fieldId is required" }, { status: 400 });

  const form = await prisma.form.findUnique({
    where: { id },
    include: { eventLinks: { include: { event: { select: { committeeId: true } } } } },
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canViewFormResponses(form as unknown as Parameters<typeof canViewFormResponses>[0], access.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, formId: true },
  });
  if (!submission || submission.formId !== id) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  const answer = await prisma.formAnswer.findUnique({
    where: { submissionId_fieldId: { submissionId, fieldId } },
    select: { id: true, fieldId: true, submissionId: true, fileKey: true, fileName: true, fileMime: true, fileSize: true },
  });
  if (!answer || !answer.fileKey) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!isSafeFormFileKey(answer.fileKey, id, fieldId)) return NextResponse.json({ error: "Invalid file reference" }, { status: 400 });

  const driver = getFormStorageDriver();
  if (driver === "disabled") return NextResponse.json({ error: "File downloads are unavailable" }, { status: 503 });

  if (driver === "local-private") {
    const bytes = await readLocalPrivateFormFile(answer.fileKey);
    const safeName = (answer.fileName || "download").replace(/[^a-zA-Z0-9._-]+/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": answer.fileMime || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const signed = await createSignedFormFileUrl(answer.fileKey);
  return NextResponse.redirect(signed.url, 302);
}

export const GET = withApiErrorHandling(GETInternal, "/api/forms/[id]/responses/[submissionId]/file");
