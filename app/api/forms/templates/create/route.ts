import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { writeAuditLog } from "@/lib/audit";
import { createPublicSlug, FORM_INCLUDE_MANAGE } from "@/lib/forms";
import { SYSTEM_FORM_TEMPLATES } from "@/lib/form-templates";

async function POSTInternal(request: Request) {
  const access = await requirePermission("forms.create");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null);
  const key = String(body?.templateKey || "");
  const template = SYSTEM_FORM_TEMPLATES.find((t) => t.key === key);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  let publicSlug = createPublicSlug();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.form.findUnique({ where: { publicSlug }, select: { id: true } });
    if (!exists) break;
    publicSlug = createPublicSlug();
  }

  const form = await prisma.form.create({
    data: {
      publicSlug,
      title: template.title,
      titleAr: template.titleAr,
      description: template.description,
      descriptionAr: template.descriptionAr,
      accessMode: "MEMBERS_ONLY",
      status: "DRAFT",
      duplicatePolicy: "ALLOW",
      createdById: access.user.id,
      updatedById: access.user.id,
      fields: { create: template.fields.map((f, idx) => ({ type: f.type, label: f.label, labelAr: f.labelAr ?? null, description: f.description ?? null, descriptionAr: f.descriptionAr ?? null, required: !!f.required, order: idx, options: (f.options ?? undefined) as Prisma.InputJsonValue | undefined, validation: (f.validation ?? undefined) as Prisma.InputJsonValue | undefined })) },
    },
    include: FORM_INCLUDE_MANAGE,
  });
  await writeAuditLog({ actorId: access.user.id, action: "form.create_from_template", targetType: "Form", targetId: form.id, details: { templateKey: key } });
  return NextResponse.json({ form }, { status: 201 });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/forms/templates/create");
