import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFormClientIpHash, isFormOpen } from "@/lib/forms";
import { FormFileUploadError } from "@/lib/form-file-storage";
import { registerAndStoreFormUpload } from "@/lib/form-uploads";

type RouteContext = { params: Promise<{ slug: string }> };

async function POSTInternal(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const form = await prisma.form.findUnique({
    where: { publicSlug: slug },
    include: { fields: { where: { isArchived: false }, select: { id: true, type: true } }, _count: { select: { submissions: true } } },
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if ((form.accessMode === "MEMBERS_ONLY" || form.accessMode === "AUTHENTICATED_USERS") && !userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const openState = isFormOpen(form, form._count.submissions);
  if (!openState.open) return NextResponse.json({ error: "Form is not accepting responses" }, { status: 400 });

  const ipHash = getFormClientIpHash(request);
  const fd = await request.formData();
  const fieldId = String(fd.get("fieldId") || "");
  const file = fd.get("file");
  if (!fieldId) return NextResponse.json({ error: "fieldId is required" }, { status: 400 });
  const field = form.fields.find((f) => f.id === fieldId);
  if (!field || field.type !== "FILE_UPLOAD") return NextResponse.json({ error: "Invalid file field" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "File is required" }, { status: 400 });

  try {
    const stored = await registerAndStoreFormUpload({
      formId: form.id,
      fieldId: field.id,
      ipHash,
      uploaderUserId: userId,
      file,
    });
    // Do not expose raw storage key in public response
    return NextResponse.json({ file: { token: stored.token, fileName: stored.fileName, fileSize: stored.fileSize, fileMime: stored.fileMime } });
  } catch (error) {
    if (error instanceof FormFileUploadError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not upload file" }, { status: 500 });
  }
}

export const POST = withApiErrorHandling(POSTInternal, "/api/public/forms/[slug]/upload");
