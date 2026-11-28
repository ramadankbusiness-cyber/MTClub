import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { canViewFormResponses } from "@/lib/forms";

type RouteContext = { params: Promise<{ id: string }> };

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") {
    const v = value as { fileName?: string };
    if (v.fileName) return String(v.fileName);
    return JSON.stringify(value);
  }
  return String(value);
}

async function GETInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("forms.responses.export");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const form = await prisma.form.findUnique({
    where: { id },
    include: { fields: { orderBy: { order: "asc" } }, eventLinks: { include: { event: { select: { committeeId: true } } } } },
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!canViewFormResponses(form, access.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "csv").toLowerCase();
  const submissions = await prisma.formSubmission.findMany({
    where: { formId: id },
    include: { answers: true, respondentUser: { select: { name: true, email: true } } },
    orderBy: { submittedAt: "desc" },
    take: 5000,
  });

  const headers = ["Submitted At", "Respondent Name", "Respondent Email", ...form.fields.map((f) => f.label)];
  const rows = submissions.map((s) => {
    const byField = new Map(s.answers.map((a) => [a.fieldId, a.value]));
    return [
      s.submittedAt.toISOString(),
      s.respondentUser?.name ?? s.respondentName ?? "",
      s.respondentUser?.email ?? s.respondentEmail ?? "",
      ...form.fields.map((f) => formatValue(byField.get(f.id))),
    ];
  });

  const safeTitle = form.title.replace(/[^a-zA-Z0-9-_ ]+/g, "").trim().slice(0, 50) || "form-responses";
  if (format === "xlsx" || format === "excel") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, "Responses");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeTitle}.xlsx"`,
      },
    });
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const csv = XLSX.utils.sheet_to_csv(ws);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle}.csv"`,
    },
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/forms/[id]/responses/export");
