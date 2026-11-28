import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canAccessCommittee } from "@/lib/permissions";
import { createPublicSlug, FORM_INCLUDE_MANAGE } from "@/lib/forms";
import { writeAuditLog } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

async function GETInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("forms.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true, committeeId: true } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (access.user.role === "LEADER" && !canAccessCommittee(access.user, event.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const links = await prisma.formEvent.findMany({
    where: { eventId: id },
    include: { form: { include: { _count: { select: { submissions: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ forms: links.map((l) => ({ linkId: l.id, kind: l.kind, form: { id: l.form.id, title: l.form.title, status: l.form.status, publicSlug: l.form.publicSlug, responseCount: l.form._count.submissions } })) });
}

async function POSTInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("forms.create");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true, title: true, committeeId: true } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (access.user.role === "LEADER" && !canAccessCommittee(access.user, event.committeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const action = String(body?.action || "create");
  const kind = (["REGISTRATION","FEEDBACK","GENERAL"].includes(body?.kind) ? body.kind : "GENERAL") as "REGISTRATION"|"FEEDBACK"|"GENERAL";

  if (action === "attach") {
    const formId = String(body?.formId || "");
    const form = await prisma.form.findUnique({ where: { id: formId }, select: { id: true } });
    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    await prisma.formEvent.upsert({ where: { formId_eventId: { formId, eventId: id } }, create: { formId, eventId: id, kind }, update: { kind } });
    return NextResponse.json({ ok: true });
  }

  // create new form linked to event
  let publicSlug = createPublicSlug();
  for (let i = 0; i < 5; i++) { const exists = await prisma.form.findUnique({ where: { publicSlug }, select: { id: true } }); if (!exists) break; publicSlug = createPublicSlug(); }
  const title = String(body?.title || `${event.title} - ${kind === "FEEDBACK" ? "Feedback" : "Registration"}`).slice(0, 200);
  const form = await prisma.form.create({
    data: {
      publicSlug, title, accessMode: "PUBLIC", status: "DRAFT", duplicatePolicy: "ALLOW",
      createdById: access.user.id, updatedById: access.user.id,
      eventLinks: { create: { eventId: id, kind } },
    },
    include: FORM_INCLUDE_MANAGE,
  });
  await writeAuditLog({ actorId: access.user.id, action: "form.create_for_event", targetType: "Form", targetId: form.id, details: { eventId: id, kind } });
  return NextResponse.json({ form }, { status: 201 });
}

export const GET = withApiErrorHandling(GETInternal, "/api/events/[id]/forms");
export const POST = withApiErrorHandling(POSTInternal, "/api/events/[id]/forms");
