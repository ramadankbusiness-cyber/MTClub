import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { FORM_INCLUDE_PUBLIC, isFormOpen } from "@/lib/forms";

type RouteContext = { params: Promise<{ slug: string }> };

async function GETInternal(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const form = await prisma.form.findUnique({
    where: { publicSlug: slug },
    include: FORM_INCLUDE_PUBLIC,
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

  // Access mode checks
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (form.accessMode === "MEMBERS_ONLY" || form.accessMode === "AUTHENTICATED_USERS") {
    if (!userId) return NextResponse.json({ error: "Authentication required", code: "AUTH_REQUIRED", accessMode: form.accessMode }, { status: 401 });
  }

  const openState = isFormOpen(form, form._count.submissions);
  const safeForm = {
    id: form.id,
    publicSlug: form.publicSlug,
    title: form.title,
    titleAr: form.titleAr,
    description: form.description,
    descriptionAr: form.descriptionAr,
    accessMode: form.accessMode,
    status: form.status,
    opensAt: form.opensAt,
    closesAt: form.closesAt,
    maxResponses: form.maxResponses,
    duplicatePolicy: form.duplicatePolicy,
    responseCount: form._count.submissions,
    isOpen: openState.open,
    openReason: openState.reason ?? null,
    eventLinks: form.eventLinks.map((l) => ({ id: l.event.id, title: l.event.title, titleAr: l.event.titleAr, kind: l.kind })),
    fields: form.fields.map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      labelAr: f.labelAr,
      description: f.description,
      descriptionAr: f.descriptionAr,
      required: f.required,
      order: f.order,
      options: f.options,
      validation: f.validation,
    })),
  };
  return NextResponse.json({ form: safeForm });
}

export const GET = withApiErrorHandling(GETInternal, "/api/public/forms/[slug]");
