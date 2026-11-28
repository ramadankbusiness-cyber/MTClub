import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { formSchema } from "@/lib/schemas";
import { writeAuditLog } from "@/lib/audit";
import { canManageAnyForms, createPublicSlug, FORM_INCLUDE_MANAGE, isChoiceField, normalizeOptionList } from "@/lib/forms";
import { canAccessCommittee } from "@/lib/permissions";

function normalizeFields(fields: Array<Record<string, unknown>>) {
  return fields.map((field, index) => {
    const options = isChoiceField(String(field.type)) ? normalizeOptionList(field.options) : [];
    return {
      type: String(field.type),
      label: String(field.label ?? "").trim(),
      labelAr: field.labelAr ? String(field.labelAr).trim() : null,
      description: field.description ? String(field.description).trim() : null,
      descriptionAr: field.descriptionAr ? String(field.descriptionAr).trim() : null,
      required: !!field.required,
      order: typeof field.order === "number" ? field.order : index,
      options: options.length ? options : undefined,
      validation: field.validation && typeof field.validation === "object" ? field.validation : undefined,
    };
  });
}

async function GETInternal(request: Request) {
  const access = await requirePermission("forms.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();
  const eventId = url.searchParams.get("eventId")?.trim();
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { titleAr: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  if (eventId) where.eventLinks = { some: { eventId } };
  if (access.user.role === "LEADER") {
    where.OR = [
      ...(where.OR ? [{ OR: where.OR }] : []),
      { createdById: access.user.id },
      { eventLinks: { some: { event: { committeeId: access.user.committeeId ?? "__none__" } } } },
    ];
    // simplify: leader sees own or committee-linked
    delete where.OR;
    where.AND = [
      ...(q ? [{ OR: [{ title: { contains: q, mode: "insensitive" } }, { titleAr: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }] : []),
      ...(status ? [{ status }] : []),
      ...(eventId ? [{ eventLinks: { some: { eventId } } }] : []),
      { OR: [{ createdById: access.user.id }, { eventLinks: { some: { event: { committeeId: access.user.committeeId ?? "__none__" } } } }] },
    ];
  }

  const forms = await prisma.form.findMany({
    where,
    include: FORM_INCLUDE_MANAGE,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ forms });
}

async function POSTInternal(request: Request) {
  const access = await requirePermission("forms.create");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!canManageAnyForms(access.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = formSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid form" }, { status: 400 });
  const data = parsed.data;

  const eventLinks = data.eventLinks ?? [];
  if (eventLinks.length) {
    const events = await prisma.event.findMany({ where: { id: { in: eventLinks.map((l) => l.eventId) } }, select: { id: true, committeeId: true } });
    if (events.length !== eventLinks.length) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (access.user.role === "LEADER") {
      for (const ev of events) {
        if (!canAccessCommittee(access.user, ev.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const fields = normalizeFields(data.fields ?? []);
  for (const field of fields) {
    if (isChoiceField(field.type) && (!field.options || field.options.length < 1)) {
      return NextResponse.json({ error: `Choice field "${field.label}" requires options` }, { status: 400 });
    }
  }

  let publicSlug = createPublicSlug();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.form.findUnique({ where: { publicSlug }, select: { id: true } });
    if (!exists) break;
    publicSlug = createPublicSlug();
  }

  const form = await prisma.form.create({
    data: {
      publicSlug,
      title: data.title,
      titleAr: data.titleAr || null,
      description: data.description || null,
      descriptionAr: data.descriptionAr || null,
      accessMode: data.accessMode,
      status: data.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      opensAt: data.opensAt ?? null,
      closesAt: data.closesAt ?? null,
      maxResponses: data.maxResponses ?? null,
      duplicatePolicy: data.duplicatePolicy,
      publishedAt: data.status === "PUBLISHED" ? new Date() : null,
      createdById: access.user.id,
      updatedById: access.user.id,
      fields: { create: fields.map((f, idx) => ({ ...f, type: f.type as Prisma.FormFieldCreateWithoutFormInput["type"], order: idx, options: (f.options ?? undefined) as Prisma.InputJsonValue | undefined, validation: (f.validation ?? undefined) as Prisma.InputJsonValue | undefined })) },
      eventLinks: eventLinks.length ? { create: eventLinks.map((l) => ({ eventId: l.eventId, kind: l.kind })) } : undefined,
    },
    include: FORM_INCLUDE_MANAGE,
  });

  await writeAuditLog({ actorId: access.user.id, action: "form.create", targetType: "Form", targetId: form.id, details: { title: form.title, accessMode: form.accessMode } });
  return NextResponse.json({ form }, { status: 201 });
}

export const GET = withApiErrorHandling(GETInternal, "/api/forms");
export const POST = withApiErrorHandling(POSTInternal, "/api/forms");
