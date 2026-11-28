import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { writeAuditLog } from "@/lib/audit";
import { canManageForm, createPublicSlug, FORM_INCLUDE_MANAGE } from "@/lib/forms";

type RouteContext = { params: Promise<{ id: string }> };

async function POSTInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("forms.create");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const existing = await prisma.form.findUnique({ where: { id }, include: { fields: { orderBy: { order: "asc" } }, eventLinks: { include: { event: { select: { committeeId: true } } } } } });
  if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canManageForm(existing, access.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let publicSlug = createPublicSlug();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.form.findUnique({ where: { publicSlug }, select: { id: true } });
    if (!exists) break;
    publicSlug = createPublicSlug();
  }

  const form = await prisma.form.create({
    data: {
      publicSlug,
      title: `${existing.title} (Copy)`,
      titleAr: existing.titleAr ? `${existing.titleAr} (نسخة)` : null,
      description: existing.description,
      descriptionAr: existing.descriptionAr,
      accessMode: existing.accessMode,
      status: "DRAFT",
      opensAt: existing.opensAt,
      closesAt: existing.closesAt,
      maxResponses: existing.maxResponses,
      duplicatePolicy: existing.duplicatePolicy,
      createdById: access.user.id,
      updatedById: access.user.id,
      fields: { create: existing.fields.map((f) => ({ type: f.type, label: f.label, labelAr: f.labelAr, description: f.description, descriptionAr: f.descriptionAr, required: f.required, order: f.order, options: f.options ?? undefined, validation: f.validation ?? undefined })) },
    },
    include: FORM_INCLUDE_MANAGE,
  });
  await writeAuditLog({ actorId: access.user.id, action: "form.duplicate", targetType: "Form", targetId: form.id, details: { sourceFormId: existing.id } });
  return NextResponse.json({ form }, { status: 201 });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/forms/[id]/duplicate");
