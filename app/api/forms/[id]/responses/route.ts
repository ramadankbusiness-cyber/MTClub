import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canViewFormResponses } from "@/lib/forms";

type RouteContext = { params: Promise<{ id: string }> };

async function GETInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("forms.responses.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const form = await prisma.form.findUnique({
    where: { id },
    include: { fields: { orderBy: { order: "asc" } }, eventLinks: { include: { event: { select: { committeeId: true } } } } },
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canViewFormResponses(form, access.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));
  const cursor = url.searchParams.get("cursor") || undefined;

  const submissions = await prisma.formSubmission.findMany({
    where: { formId: id },
    include: { answers: true, respondentUser: { select: { id: true, name: true, email: true } } },
    orderBy: { submittedAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  let items = submissions;
  if (q) {
    items = items.filter((s) => {
      const hay = [s.respondentName, s.respondentEmail, s.respondentUser?.name, s.respondentUser?.email, s.publicId, ...s.answers.map((a) => typeof a.value === "string" ? a.value : JSON.stringify(a.value ?? ""))].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  const hasMore = items.length > take;
  const pageItems = hasMore ? items.slice(0, take) : items;
  const nextCursor = hasMore ? pageItems[pageItems.length - 1]?.id : null;

  const total = await prisma.formSubmission.count({ where: { formId: id } });

  return NextResponse.json({
    form: { id: form.id, title: form.title, titleAr: form.titleAr, publicSlug: form.publicSlug },
    fields: form.fields.map((f) => ({ id: f.id, label: f.label, labelAr: f.labelAr, type: f.type, options: f.options })),
    total,
    submissions: pageItems.map((s) => ({
      id: s.id,
      publicId: s.publicId,
      submittedAt: s.submittedAt,
      respondentName: s.respondentUser?.name ?? s.respondentName,
      respondentEmail: s.respondentUser?.email ?? s.respondentEmail,
      respondentUserId: s.respondentUserId,
      answers: s.answers.map((a) => ({ fieldId: a.fieldId, value: a.value, fileName: a.fileName, hasFile: !!a.fileKey, fileSize: a.fileSize, fileMime: a.fileMime })),
    })),
    nextCursor,
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/forms/[id]/responses");
