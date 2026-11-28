import { withApiErrorHandling } from "@/lib/api-error-handler";
import { writeAuditLog } from "@/lib/audit";
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formSubmissionSchema } from "@/lib/schemas";
import { createPublicId, getFormClientIpHash, isFormOpen, normalizeOptionList } from "@/lib/forms";
import { hashIdentifier } from "@/lib/security";
import { deleteFormFileIfUnreferenced, FormFileUploadError } from "@/lib/form-file-storage";
import { attachFormUploadsToSubmission, verifyAndConsumePendingFormUpload } from "@/lib/form-uploads";

type RouteContext = { params: Promise<{ slug: string }> };

function asString(v: unknown) { return typeof v === "string" ? v.trim() : ""; }
function isValidEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function isValidPhone(v: string) { return /^[+]?[\d\s().-]{7,20}$/.test(v); }

async function POSTInternal(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const form = await prisma.form.findUnique({
    where: { publicSlug: slug },
    include: { fields: { where: { isArchived: false }, orderBy: { order: "asc" } }, _count: { select: { submissions: true } } },
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (form.accessMode === "MEMBERS_ONLY" || form.accessMode === "AUTHENTICATED_USERS") {
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const openState = isFormOpen(form, form._count.submissions);
  if (!openState.open) return NextResponse.json({ error: "Form is not accepting responses", reason: openState.reason }, { status: 400 });

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  const body = await request.json().catch(() => null);
  const parsed = formSubmissionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true, submissionId: "accepted" }, { status: 200 });

  const ipHash = getFormClientIpHash(request);
  const ua = request.headers.get("user-agent") || "";
  const userAgentHash = hashIdentifier(ua.slice(0, 500));

  const since = new Date(Date.now() - 15 * 60 * 1000);
  const recentByIp = await prisma.formSubmission.count({ where: { formId: form.id, ipHash, submittedAt: { gte: since } } });
  if (recentByIp >= 10) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });

  const answerMap = new Map<string, unknown>();
  for (const a of parsed.data.answers ?? []) {
    if (a && typeof a.fieldId === "string") answerMap.set(a.fieldId, a.value);
  }

  if (form.duplicatePolicy === "ONE_PER_USER" && userId) {
    const existing = await prisma.formSubmission.findFirst({ where: { formId: form.id, respondentUserId: userId }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "You have already submitted this form." }, { status: 409 });
  }
  if (form.duplicatePolicy === "ONE_PER_EMAIL") {
    const email = asString(parsed.data.respondentEmail).toLowerCase() || asString(answerMap.get(form.fields.find(f => f.type === "EMAIL")?.id || ""));
    if (email) {
      const existing = await prisma.formSubmission.findFirst({ where: { formId: form.id, respondentEmail: email }, select: { id: true } });
      if (existing) return NextResponse.json({ error: "This email has already submitted this form." }, { status: 409 });
    }
  }
  if (form.duplicatePolicy === "ONE_PER_IP") {
    const existing = await prisma.formSubmission.findFirst({ where: { formId: form.id, ipHash }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "A response has already been submitted from this network." }, { status: 409 });
  }

  const consumedUploadKeys: Array<{ key: string; fieldId: string; jti: string }> = [];
  const answersToCreate: Array<{ fieldId: string; value: unknown; fileKey: string | null; fileName: string | null; fileSize: number | null; fileMime: string | null }> = [];
  let respondentEmail: string | null = parsed.data.respondentEmail ? asString(parsed.data.respondentEmail).toLowerCase() : null;
  let submissionPersisted = false;
  const cleanupConsumedUploads = async () => {
    if (submissionPersisted || consumedUploadKeys.length === 0) return;
    for (const f of consumedUploadKeys) {
      await Promise.resolve(deleteFormFileIfUnreferenced(f.key, form.id, f.fieldId)).catch(() => undefined);
      await Promise.resolve(prisma.formUpload.updateMany({
        where: { tokenJti: f.jti, formId: form.id, fieldId: f.fieldId, key: f.key, status: "PENDING" },
        data: { status: "EXPIRED" },
      })).catch(() => undefined);
    }
  };
  try {
  for (const field of form.fields) {
    const raw = answerMap.get(field.id);
    const validation = (field.validation && typeof field.validation === "object") ? field.validation as Record<string, unknown> : {};
    const required = field.required;
    const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (required) return NextResponse.json({ error: `Field "${field.label}" is required` }, { status: 400 });
      continue;
    }
    let value: unknown = null;
    let fileKey: string | null = null;
    let fileName: string | null = null;
    let fileSize: number | null = null;
    let fileMime: string | null = null;

    switch (field.type) {
      case "SHORT_ANSWER":
      case "PARAGRAPH": {
        const s = asString(raw);
        const maxLen = field.type === "SHORT_ANSWER" ? 500 : 5000;
        if (s.length > maxLen) return NextResponse.json({ error: `Field "${field.label}" is too long` }, { status: 400 });
        if (validation.minLength && s.length < Number(validation.minLength)) return NextResponse.json({ error: `Field "${field.label}" is too short` }, { status: 400 });
        value = s;
        break;
      }
      case "EMAIL": {
        const s = asString(raw).toLowerCase();
        if (!isValidEmail(s)) return NextResponse.json({ error: `Field "${field.label}" must be a valid email` }, { status: 400 });
        value = s;
        if (!respondentEmail) respondentEmail = s;
        break;
      }
      case "PHONE": {
        const s = asString(raw);
        if (!isValidPhone(s)) return NextResponse.json({ error: `Field "${field.label}" must be a valid phone number` }, { status: 400 });
        value = s;
        break;
      }
      case "NUMBER": {
        const n = typeof raw === "number" ? raw : Number(String(raw));
        if (!Number.isFinite(n)) return NextResponse.json({ error: `Field "${field.label}" must be a number` }, { status: 400 });
        if (validation.min !== undefined && n < Number(validation.min)) return NextResponse.json({ error: `Field "${field.label}" is below minimum` }, { status: 400 });
        if (validation.max !== undefined && n > Number(validation.max)) return NextResponse.json({ error: `Field "${field.label}" is above maximum` }, { status: 400 });
        value = n;
        break;
      }
      case "DATE": {
        const s = asString(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NextResponse.json({ error: `Field "${field.label}" must be a valid date` }, { status: 400 });
        value = s;
        break;
      }
      case "TIME": {
        const s = asString(raw);
        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return NextResponse.json({ error: `Field "${field.label}" must be a valid time` }, { status: 400 });
        value = s;
        break;
      }
      case "MULTIPLE_CHOICE":
      case "DROPDOWN": {
        const s = asString(raw);
        const options = normalizeOptionList(field.options);
        if (!options.includes(s)) return NextResponse.json({ error: `Invalid option for "${field.label}"` }, { status: 400 });
        value = s;
        break;
      }
      case "CHECKBOXES": {
        const arr = Array.isArray(raw) ? raw.map(asString).filter(Boolean) : [];
        const options = normalizeOptionList(field.options);
        if (arr.length === 0 && required) return NextResponse.json({ error: `Field "${field.label}" is required` }, { status: 400 });
        if (arr.some((v) => !options.includes(v))) return NextResponse.json({ error: `Invalid option for "${field.label}"` }, { status: 400 });
        value = Array.from(new Set(arr));
        break;
      }
      case "FILE_UPLOAD": {
        const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
        const token = asString(obj?.token);
        const verified = await verifyAndConsumePendingFormUpload(token, form.id, field.id);
        if (!verified) return NextResponse.json({ error: `Field "${field.label}" requires a valid uploaded file` }, { status: 400 });
        fileKey = verified.key;
        fileName = verified.fileName;
        fileSize = verified.fileSize;
        fileMime = verified.fileMime;
        consumedUploadKeys.push({ key: verified.key, fieldId: field.id, jti: verified.jti });
        // store only metadata reference in answer value; do not expose key in public responses
        value = { fileName, fileSize, fileMime, hasFile: true };
        break;
      }
      default:
        return NextResponse.json({ error: `Unsupported field type for "${field.label}"` }, { status: 400 });
    }
    answersToCreate.push({ fieldId: field.id, value, fileKey, fileName, fileSize, fileMime });
  }

  type SubmissionResult = { id: string; publicId: string; submittedAt: Date } | { closed: string } | { duplicate: "user" | "email" | "ip" } | { conflict: true };
  let submission: SubmissionResult = { conflict: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      submission = await prisma.$transaction(async (tx) => {
        const countNow = await tx.formSubmission.count({ where: { formId: form.id } });
        const openNow = isFormOpen(form, countNow);
        if (!openNow.open) return { closed: openNow.reason || "closed" } as const;

        if (form.duplicatePolicy === "ONE_PER_USER" && userId) {
          const existing = await tx.formSubmission.findFirst({ where: { formId: form.id, respondentUserId: userId }, select: { id: true } });
          if (existing) return { duplicate: "user" as const };
        }
        if (form.duplicatePolicy === "ONE_PER_EMAIL" && respondentEmail) {
          const existing = await tx.formSubmission.findFirst({ where: { formId: form.id, respondentEmail }, select: { id: true } });
          if (existing) return { duplicate: "email" as const };
        }
        if (form.duplicatePolicy === "ONE_PER_IP") {
          const existing = await tx.formSubmission.findFirst({ where: { formId: form.id, ipHash }, select: { id: true } });
          if (existing) return { duplicate: "ip" as const };
        }

        const created = await tx.formSubmission.create({
          data: {
            publicId: createPublicId(),
            formId: form.id,
            respondentUserId: userId,
            respondentEmail: respondentEmail || null,
            respondentName: parsed.data.respondentName ? asString(parsed.data.respondentName).slice(0, 200) : null,
            ipHash,
            userAgentHash,
            answers: { create: answersToCreate as Prisma.FormAnswerUncheckedCreateWithoutSubmissionInput[] },
          },
          select: { id: true, publicId: true, submittedAt: true },
        });
        if (consumedUploadKeys.length > 0) {
          await attachFormUploadsToSubmission(tx, form.id, created.id, consumedUploadKeys);
        }
        if (userId) {
          await writeAuditLog({ actorId: userId, action: "form.submit", targetType: "Form", targetId: form.id, details: { formId: form.id, submissionId: created.id } }, tx);
        }
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (err: unknown) {
      if (err instanceof FormFileUploadError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      const code = (err && typeof err === "object" && "code" in err) ? String((err as { code?: unknown }).code) : "";
      if (code === "P2034" && attempt < 2) {
        continue; // bounded retry on serialization conflict
      }
      if (code === "P2034") {
        submission = { conflict: true };
        break;
      }
      throw err;
    }
  }

  if ("conflict" in submission) return NextResponse.json({ error: "Could not submit right now. Please try again." }, { status: 409 });
  if ("closed" in submission) return NextResponse.json({ error: "Form is not accepting responses", reason: submission.closed }, { status: 400 });
  if ("duplicate" in submission) {
    const msg = submission.duplicate === "user" ? "You have already submitted this form." : submission.duplicate === "email" ? "This email has already submitted this form." : "A response has already been submitted from this network.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  submissionPersisted = true;
  return NextResponse.json({ ok: true, submissionId: submission.publicId, submittedAt: submission.submittedAt }, { status: 201 });
  } finally {
    await cleanupConsumedUploads();
  }
}

export const POST = withApiErrorHandling(POSTInternal, "/api/public/forms/[slug]/submit");
