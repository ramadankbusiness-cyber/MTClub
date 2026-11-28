import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashIdentifier, requestIp } from "@/lib/security";
import type { Prisma } from "@/lib/generated/prisma";

export const FORM_FIELD_TYPES = ["SHORT_ANSWER","PARAGRAPH","MULTIPLE_CHOICE","CHECKBOXES","DROPDOWN","NUMBER","DATE","TIME","EMAIL","PHONE","FILE_UPLOAD"] as const;
export type FormFieldTypeValue = typeof FORM_FIELD_TYPES[number];
export const FORM_ACCESS_MODES = ["MEMBERS_ONLY","AUTHENTICATED_USERS","PUBLIC"] as const;
export type FormAccessModeValue = typeof FORM_ACCESS_MODES[number];
export const FORM_STATUSES = ["DRAFT","PUBLISHED","CLOSED","ARCHIVED"] as const;
export type FormStatusValue = typeof FORM_STATUSES[number];
export const FORM_DUPLICATE_POLICIES = ["ALLOW","ONE_PER_USER","ONE_PER_EMAIL","ONE_PER_IP"] as const;
export type FormDuplicatePolicyValue = typeof FORM_DUPLICATE_POLICIES[number];
export const FORM_EVENT_KINDS = ["REGISTRATION","FEEDBACK","GENERAL"] as const;
export type FormEventKindValue = typeof FORM_EVENT_KINDS[number];

export function createPublicSlug(bytes = 18): string {
  return randomBytes(bytes).toString("base64url").slice(0, 24);
}

export function createPublicId(bytes = 18): string {
  return randomBytes(bytes).toString("base64url").slice(0, 24);
}

export function hashFormEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export function getFormClientIpHash(request: Request): string {
  return hashIdentifier(requestIp(request));
}

export function isFormOpen(form: { status: string; opensAt?: Date | null; closesAt?: Date | null; maxResponses?: number | null }, responseCount: number, now = new Date()): { open: boolean; reason?: "draft" | "closed" | "archived" | "not_open_yet" | "expired" | "limit_reached" } {
  if (form.status === "ARCHIVED") return { open: false, reason: "archived" };
  if (form.status === "CLOSED") return { open: false, reason: "closed" };
  if (form.status === "DRAFT") return { open: false, reason: "draft" };
  if (form.opensAt && now < form.opensAt) return { open: false, reason: "not_open_yet" };
  if (form.closesAt && now > form.closesAt) return { open: false, reason: "expired" };
  if (typeof form.maxResponses === "number" && form.maxResponses >= 0 && responseCount >= form.maxResponses) {
    return { open: false, reason: "limit_reached" };
  }
  return { open: true };
}

export type FormActor = { id: string; role: "ADMIN" | "LEADER" | "MEMBER"; committeeId: string | null; isActive: boolean } | null;

export function canManageAnyForms(role?: string | null) {
  return role === "ADMIN" || role === "LEADER";
}

export function canManageForm(form: { createdById: string; eventLinks?: { event: { committeeId: string | null } }[] }, actor: NonNullable<FormActor>): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "LEADER") return false;
  if (form.createdById === actor.id) return true;
  const committeeId = actor.committeeId;
  if (!committeeId) return false;
  return (form.eventLinks ?? []).some((link) => link.event.committeeId === committeeId);
}

export function canViewFormResponses(form: { createdById: string; eventLinks?: { event: { committeeId: string | null } }[] }, actor: NonNullable<FormActor>): boolean {
  return canManageForm(form, actor);
}

export function normalizeOptionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(trimmed.slice(0, 200));
    if (options.length >= 50) break;
  }
  return options;
}

export function isChoiceField(type: string) {
  return type === "MULTIPLE_CHOICE" || type === "CHECKBOXES" || type === "DROPDOWN";
}

export function validateFieldOptions(type: string, options: unknown): string[] {
  if (!isChoiceField(type)) return [];
  const normalized = normalizeOptionList(options);
  return normalized;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "upload";
}

const uploadRateHits = new Map<string, { count: number; resetAt: number }>();
export function checkFormUploadRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = uploadRateHits.get(key);
  if (!entry || entry.resetAt <= now) {
    uploadRateHits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) return { ok: false, remaining: 0 };
  entry.count += 1;
  return { ok: true, remaining: limit - entry.count };
}

export async function getFormBySlug(slug: string) {
  return prisma.form.findUnique({
    where: { publicSlug: slug },
    include: {
      fields: { where: { isArchived: false }, orderBy: { order: "asc" } },
      eventLinks: { include: { event: { select: { id: true, title: true, titleAr: true, committeeId: true } } } },
      _count: { select: { submissions: true } },
    },
  });
}

export async function getFormForManage(formId: string) {
  return prisma.form.findUnique({
    where: { id: formId },
    include: {
      fields: { orderBy: { order: "asc" } },
      eventLinks: { include: { event: { select: { id: true, title: true, titleAr: true, committeeId: true, startsAt: true } } } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
  });
}

export const FORM_INCLUDE_MANAGE = {
  fields: { orderBy: { order: "asc" as const } },
  eventLinks: { include: { event: { select: { id: true, title: true, titleAr: true, committeeId: true, startsAt: true } } } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { submissions: true } },
} satisfies Prisma.FormInclude;

export const FORM_INCLUDE_PUBLIC = {
  fields: { where: { isArchived: false }, orderBy: { order: "asc" as const } },
  eventLinks: { include: { event: { select: { id: true, title: true, titleAr: true } } } },
  _count: { select: { submissions: true } },
} satisfies Prisma.FormInclude;
