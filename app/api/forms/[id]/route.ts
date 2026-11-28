import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { formSchema } from "@/lib/schemas";
import { writeAuditLog } from "@/lib/audit";
import { canManageForm, FORM_INCLUDE_MANAGE, isChoiceField, normalizeOptionList } from "@/lib/forms";
import { canAccessCommittee } from "@/lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

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

async function getManagedForm(id: string) {
  return prisma.form.findUnique({
    where: { id },
    include: {
      ...FORM_INCLUDE_MANAGE,
      eventLinks: { include: { event: { select: { id: true, title: true, titleAr: true, committeeId: true, startsAt: true } } } },
    },
  });
}

async function GETInternal(_: Request, context: RouteContext) {
  const access = await requirePermission("forms.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const form = await getManagedForm(id);
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canManageForm(form, access.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ form });
}

async function PATCHInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("forms.update");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const existing = await getManagedForm(id);
  if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canManageForm(existing, access.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const nextStatus = data.status ?? existing.status;
  if (nextStatus === "ARCHIVED" && access.user.role !== "ADMIN" && existing.createdById !== access.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const statusPatch: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === "PUBLISHED" && !existing.publishedAt) statusPatch.publishedAt = now;
  if (nextStatus === "CLOSED") statusPatch.closedAt = now;
  if (nextStatus === "ARCHIVED") statusPatch.archivedAt = now;
  if (nextStatus === "PUBLISHED") { statusPatch.closedAt = null; statusPatch.archivedAt = null; }
  if (nextStatus === "DRAFT") { statusPatch.closedAt = null; statusPatch.archivedAt = null; }

  const existingFieldIds = new Set(existing.fields.map((f) => f.id));
  const incomingIds = new Set<string>();
  const answerCounts = await prisma.formAnswer.groupBy({
    by: ["fieldId"],
    where: { fieldId: { in: existing.fields.map((f) => f.id) } },
    _count: { _all: true },
  });
  const answerCountByField = new Map(answerCounts.map((r) => [r.fieldId, r._count._all]));

  for (let idx = 0; idx < fields.length; idx++) {
    const incoming = (data.fields ?? [])[idx] as Record<string, unknown> | undefined;
    const incomingId = typeof incoming?.id === "string" ? incoming.id : null;
    if (incomingId && existingFieldIds.has(incomingId)) incomingIds.add(incomingId);
  }
  const toRemove = existing.fields.filter((f) => !incomingIds.has(f.id));
  const blockedDelete = toRemove.find((f) => (answerCountByField.get(f.id) ?? 0) > 0);
  if (blockedDelete) {
    return NextResponse.json({ error: `Cannot delete question "${blockedDelete.label}" because it already has responses. Archive/disable it instead.` }, { status: 400 });
  }
  for (let idx = 0; idx < fields.length; idx++) {
    const incoming = (data.fields ?? [])[idx] as Record<string, unknown> | undefined;
    const f = fields[idx];
    const incomingId = typeof incoming?.id === "string" ? incoming.id : null;
    if (incomingId && existingFieldIds.has(incomingId)) {
      const prev = existing.fields.find((x) => x.id === incomingId);
      const prevAnswers = answerCountByField.get(incomingId) ?? 0;
      if (prev && prevAnswers > 0 && String(f.type) !== prev.type) {
        return NextResponse.json({ error: `Cannot change type of question "${prev.label}" because it already has responses.` }, { status: 400 });
      }
    }
  }

  const form = await prisma.$transaction(async (tx) => {
    for (let idx = 0; idx < fields.length; idx++) {
      const incoming = (data.fields ?? [])[idx] as Record<string, unknown> | undefined;
      const f = fields[idx];
      const isArchived = incoming?.isArchived === true;
      const fieldData = {
        type: f.type,
        label: f.label,
        labelAr: f.labelAr,
        description: f.description,
        descriptionAr: f.descriptionAr,
        required: isArchived ? false : f.required,
        order: idx,
        options: f.options ?? (isChoiceField(f.type) ? [] : Prisma.DbNull),
        validation: f.validation ?? Prisma.DbNull,
        isArchived,
      } as Record<string, unknown>;
      const incomingId = typeof incoming?.id === "string" ? incoming.id : null;
      if (incomingId && existingFieldIds.has(incomingId)) {
        await tx.formField.update({ where: { id: incomingId }, data: fieldData as Prisma.FormFieldUncheckedUpdateInput });
      } else {
        await tx.formField.create({ data: { ...(fieldData as Prisma.FormFieldUncheckedCreateInput), formId: id } as Prisma.FormFieldUncheckedCreateInput });
      }
    }
    const toDelete = existing.fields.filter((f) => !incomingIds.has(f.id)).map((f) => f.id);
    if (toDelete.length) await tx.formField.deleteMany({ where: { id: { in: toDelete }, formId: id } });

    await tx.formEvent.deleteMany({ where: { formId: id } });
    if (eventLinks.length) {
      await tx.formEvent.createMany({ data: eventLinks.map((l) => ({ formId: id, eventId: l.eventId, kind: l.kind as "REGISTRATION"|"FEEDBACK"|"GENERAL" })) });
    }

    return tx.form.update({
      where: { id },
      data: {
        title: data.title,
        titleAr: data.titleAr || null,
        description: data.description || null,
        descriptionAr: data.descriptionAr || null,
        accessMode: data.accessMode,
        ...statusPatch,
        opensAt: data.opensAt ?? null,
        closesAt: data.closesAt ?? null,
        maxResponses: data.maxResponses ?? null,
        duplicatePolicy: data.duplicatePolicy,
        updatedById: access.user.id,
      },
      include: FORM_INCLUDE_MANAGE,
    });
  });

  await writeAuditLog({ actorId: access.user.id, action: "form.update", targetType: "Form", targetId: form.id, details: { status: form.status } });
  return NextResponse.json({ form });
}

async function DELETEInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("forms.delete");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const existing = await getManagedForm(id);
  if (!existing) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canManageForm(existing, access.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.form.delete({ where: { id } });
  await writeAuditLog({ actorId: access.user.id, action: "form.delete", targetType: "Form", targetId: id, details: { title: existing.title } });
  return NextResponse.json({ ok: true });
}

export const GET = withApiErrorHandling(GETInternal, "/api/forms/[id]");
export const PATCH = withApiErrorHandling(PATCHInternal, "/api/forms/[id]");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/forms/[id]");
