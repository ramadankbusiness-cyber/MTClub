import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma";

export type ActivityCategory = "ACCOUNT" | "PROFILE" | "EVENT" | "FORM" | "ATTENDANCE" | "POINTS" | "CERTIFICATE" | "SECURITY" | "ADMIN";

export type ActivityItem = {
  id: string;
  type: string;
  category: ActivityCategory;
  createdAt: string;
  titleKey: string;
  descriptionKey: string;
  descriptionParams?: Record<string, string | number>;
  href: string | null;
  actor: "SELF" | "ADMIN" | "SYSTEM";
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
};

const PAGE_SIZE_MAX = 50;

function iso(d: Date) { return d.toISOString(); }

function safeString(v: unknown, max = 120) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function isActivityCategory(value: string): value is ActivityCategory {
  return ["ACCOUNT","PROFILE","EVENT","FORM","ATTENDANCE","POINTS","CERTIFICATE","SECURITY","ADMIN"].includes(value);
}

const AUDIT_MEMBER_MAP: Record<string, { type: string; category: ActivityCategory; titleKey: string; descriptionKey: string; href?: string | ((targetId: string | null) => string | null); actor: "SELF"|"ADMIN"|"SYSTEM" }> = {
  "profile.update": { type: "profile.updated", category: "PROFILE", titleKey: "profileUpdated", descriptionKey: "profileUpdatedDesc", href: "/profile", actor: "SELF" },
  "profile.photo.update": { type: "profile.photo_updated", category: "PROFILE", titleKey: "profilePhotoUpdated", descriptionKey: "profilePhotoUpdatedDesc", href: "/profile", actor: "SELF" },
  "user.password.change": { type: "security.password_changed", category: "SECURITY", titleKey: "passwordChanged", descriptionKey: "passwordChangedDesc", href: "/profile", actor: "SELF" },
  "user.password.reset.completed": { type: "security.password_reset_completed", category: "SECURITY", titleKey: "passwordResetCompleted", descriptionKey: "passwordResetCompletedDesc", href: "/profile", actor: "SELF" },
  "user.password.reset.requested": { type: "security.password_reset_requested", category: "SECURITY", titleKey: "passwordResetRequested", descriptionKey: "passwordResetRequestedDesc", href: undefined, actor: "SELF" },
  "user.create": { type: "account.created", category: "ACCOUNT", titleKey: "accountCreated", descriptionKey: "accountCreatedDesc", href: "/profile", actor: "ADMIN" },
  "user.activate": { type: "account.activated", category: "ACCOUNT", titleKey: "accountActivated", descriptionKey: "accountActivatedDesc", href: "/profile", actor: "ADMIN" },
  "user.deactivate": { type: "account.deactivated", category: "ACCOUNT", titleKey: "accountDeactivated", descriptionKey: "accountDeactivatedDesc", href: "/profile", actor: "ADMIN" },
  "user.role.change": { type: "account.role_changed", category: "ACCOUNT", titleKey: "roleChanged", descriptionKey: "roleChangedDesc", href: "/profile", actor: "ADMIN" },
  "user.update": { type: "account.updated", category: "ACCOUNT", titleKey: "accountUpdated", descriptionKey: "accountUpdatedDesc", href: "/profile", actor: "ADMIN" },
  "excuse.create": { type: "attendance.excuse_submitted", category: "ATTENDANCE", titleKey: "excuseSubmitted", descriptionKey: "excuseSubmittedDesc", href: "/attendance", actor: "SELF" },
  "excuse.approved": { type: "attendance.excuse_approved", category: "ATTENDANCE", titleKey: "excuseApproved", descriptionKey: "excuseApprovedDesc", href: "/attendance", actor: "ADMIN" },
  "excuse.rejected": { type: "attendance.excuse_rejected", category: "ATTENDANCE", titleKey: "excuseRejected", descriptionKey: "excuseRejectedDesc", href: "/attendance", actor: "ADMIN" },
};

function auditToMemberItem(log: { id: string; action: string; targetType: string; targetId: string | null; actorId: string | null; createdAt: Date; details: unknown; actor: { name: string } | null }, memberId: string): ActivityItem | null {
  const def = AUDIT_MEMBER_MAP[log.action];
  if (!def) return null;
  // Only show logs relevant to this member
  const isTarget = log.targetType === "User" && log.targetId === memberId;
  const isSelfActor = log.actorId === memberId;
  if (!isTarget && !isSelfActor) return null;
  // For admin actions targeting user, actor is admin/system
  let actor: ActivityItem["actor"] = def.actor;
  if (isTarget && log.actorId && log.actorId !== memberId) actor = "ADMIN";
  if (isTarget && !log.actorId) actor = "SYSTEM";
  if (isSelfActor && !isTarget) actor = "SELF";
  const href = typeof def.href === "function" ? def.href(log.targetId) : (def.href ?? null);
  return {
    id: `audit:${log.id}`,
    type: def.type,
    category: def.category,
    createdAt: iso(log.createdAt),
    titleKey: def.titleKey,
    descriptionKey: def.descriptionKey,
    href,
    actor,
    actorName: actor === "SELF" ? null : (log.actor?.name ?? null),
    targetUserId: memberId,
    targetName: null,
  };
}

export async function getMemberActivity(opts: { userId: string; category?: ActivityCategory; limit?: number; before?: string | null; q?: string }) {
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(opts.limit ?? 20)));
  const beforeDate = opts.before ? new Date(opts.before) : null;
  const beforeFilter = beforeDate && !Number.isNaN(beforeDate.getTime()) ? { lt: beforeDate } : undefined;
  const q = (opts.q || "").trim().toLowerCase().slice(0, 100);
  const cat = opts.category;

  const items: ActivityItem[] = [];
  const take = Math.max(limit * 3, 60);

  // Domain records - only fetch categories that are requested or all
  const wantAll = !cat;
  if (wantAll || cat === "POINTS") {
    const rows = await prisma.pointTransaction.findMany({
      where: { userId: opts.userId, ...(beforeFilter ? { createdAt: beforeFilter } : {}) },
      orderBy: { createdAt: "desc" }, take,
      select: { id: true, amount: true, reason: true, type: true, createdAt: true },
    });
    for (const r of rows) items.push({
      id: `pt:${r.id}`, type: r.amount >= 0 ? "points.earned" : "points.deducted", category: "POINTS",
      createdAt: iso(r.createdAt),
      titleKey: r.amount >= 0 ? "pointsEarned" : "pointsDeducted",
      descriptionKey: r.amount >= 0 ? "pointsEarnedDesc" : "pointsDeductedDesc",
      descriptionParams: { amount: Math.abs(r.amount), reason: safeString(r.reason, 120) },
      href: "/profile", actor: (r.type === "MANUAL_ADD" || r.type === "MANUAL_DEDUCT" || r.type === "ATTENDANCE_ADJUSTMENT") ? "ADMIN" : "SYSTEM", actorName: null, targetUserId: opts.userId, targetName: null,
    });
  }
  if (wantAll || cat === "FORM") {
    const rows = await prisma.formSubmission.findMany({
      where: { respondentUserId: opts.userId, ...(beforeFilter ? { submittedAt: beforeFilter } : {}) },
      orderBy: { submittedAt: "desc" }, take,
      select: { id: true, submittedAt: true, form: { select: { title: true, publicSlug: true } } },
    });
    for (const r of rows) items.push({
      id: `fs:${r.id}`, type: "form.submitted", category: "FORM", createdAt: iso(r.submittedAt),
      titleKey: "formSubmitted", descriptionKey: "formSubmittedDesc", descriptionParams: { form: safeString(r.form.title, 120) },
      href: r.form.publicSlug ? `/forms/${r.form.publicSlug}` : null, actor: "SELF", actorName: null, targetUserId: opts.userId, targetName: null,
    });
  }
  if (wantAll || cat === "ATTENDANCE") {
    const rows = await prisma.attendanceRecord.findMany({
      where: { userId: opts.userId, ...(beforeFilter ? { checkedInAt: beforeFilter } : {}) },
      orderBy: { checkedInAt: "desc" }, take,
      select: { id: true, status: true, checkedInAt: true, session: { select: { title: true, eventId: true } } },
    });
    for (const r of rows) items.push({
      id: `ar:${r.id}`, type: "attendance.recorded", category: "ATTENDANCE", createdAt: iso(r.checkedInAt ?? new Date(0)),
      titleKey: "attendanceRecorded", descriptionKey: "attendanceRecordedDesc",
      descriptionParams: { status: r.status, session: safeString(r.session.title, 120) },
      href: r.session.eventId ? `/events/${r.session.eventId}` : "/attendance", actor: "SYSTEM", actorName: null, targetUserId: opts.userId, targetName: null,
    });
  }
  if (wantAll || cat === "EVENT") {
    const ready = await prisma.eventReadiness.findMany({
      where: { userId: opts.userId, ...(beforeFilter ? { createdAt: beforeFilter } : {}) },
      orderBy: { createdAt: "desc" }, take,
      select: { id: true, createdAt: true, event: { select: { id: true, title: true } } },
    });
    for (const r of ready) items.push({
      id: `erd:${r.id}`, type: "event.ready", category: "EVENT", createdAt: iso(r.createdAt),
      titleKey: "eventReady", descriptionKey: "eventReadyDesc", descriptionParams: { event: safeString(r.event.title, 120) },
      href: `/events/${r.event.id}`, actor: "SELF", actorName: null, targetUserId: opts.userId, targetName: null,
    });
  }
  if (wantAll || cat === "CERTIFICATE") {
    const rows = await prisma.certificate.findMany({
      where: { userId: opts.userId, ...(beforeFilter ? { createdAt: beforeFilter } : {}) },
      orderBy: { createdAt: "desc" }, take,
      select: { id: true, createdAt: true, title: true, issuedBy: { select: { name: true } } },
    });
    for (const r of rows) items.push({
      id: `cert:${r.id}`, type: "certificate.issued", category: "CERTIFICATE", createdAt: iso(r.createdAt),
      titleKey: "certificateIssued", descriptionKey: "certificateIssuedDesc", descriptionParams: { title: safeString(r.title, 120) },
      href: "/certificates", actor: "ADMIN", actorName: r.issuedBy?.name ?? null, targetUserId: opts.userId, targetName: null,
    });
  }

  // AuditLog - member-relevant actions
  if (wantAll || ["ACCOUNT","PROFILE","SECURITY","ATTENDANCE","ADMIN"].includes(cat as string)) {
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(beforeFilter ? { createdAt: beforeFilter } : {}),
        OR: [
          { targetType: "User", targetId: opts.userId },
          { actorId: opts.userId, action: { in: Object.keys(AUDIT_MEMBER_MAP) } },
        ],
      },
      orderBy: { createdAt: "desc" }, take,
      include: { actor: { select: { name: true } } },
    });
    for (const log of logs) {
      const item = auditToMemberItem(log, opts.userId);
      if (item) items.push(item);
    }
  }

  // dedupe by id, filter by category after merge (audit may add), search, sort, paginate
  const seen = new Set<string>();
  let merged = items.filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
  if (cat) merged = merged.filter((i) => i.category === cat);
  if (q) merged = merged.filter((i) => {
    const hay = `${i.titleKey} ${i.descriptionKey} ${Object.values(i.descriptionParams || {}).join(" ")} ${i.actorName || ""}`.toLowerCase();
    return hay.includes(q);
  });
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));

  const hasMore = merged.length > limit;
  const page = hasMore ? merged.slice(0, limit) : merged;
  const nextCursor = hasMore && page.length ? page[page.length - 1].createdAt : null;
  return { items: page, hasMore, nextCursor };
}

export async function getAdminActivity(opts: { memberId?: string; category?: ActivityCategory; limit?: number; before?: string | null; from?: string | null; to?: string | null; q?: string }) {
  // Admin review: if memberId provided, reuse member activity (full view for that member). Otherwise, show recent AuditLog entries.
  if (opts.memberId) {
    return getMemberActivity({ userId: opts.memberId, category: opts.category, limit: opts.limit, before: opts.before, q: opts.q });
  }
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(opts.limit ?? 20)));
  const beforeDate = opts.before ? new Date(opts.before) : null;
  const fromDate = opts.from ? new Date(opts.from) : null;
  const toDate = opts.to ? new Date(opts.to) : null;
  const createdAt: Prisma.DateTimeFilter = {};
  if (beforeDate && !Number.isNaN(beforeDate.getTime())) createdAt.lt = beforeDate;
  if (fromDate && !Number.isNaN(fromDate.getTime())) createdAt.gte = fromDate;
  if (toDate && !Number.isNaN(toDate.getTime())) createdAt.lte = toDate;
  const q = (opts.q || "").trim().slice(0, 100);
  const where: Prisma.AuditLogWhereInput = { ...(Object.keys(createdAt).length ? { createdAt } : {}) };
  if (q) where.OR = [{ action: { contains: q } }, { targetType: { contains: q } }, { targetId: { contains: q } }];
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;
  const targetUserIds = Array.from(new Set(page.filter(l => l.targetType === "User" && l.targetId).map(l => l.targetId as string)));
  const targets = targetUserIds.length ? await prisma.user.findMany({ where: { id: { in: targetUserIds } }, select: { id: true, name: true, email: true } }) : [];
  const targetMap = new Map(targets.map(t => [t.id, t]));
  const items = page.map((l) => {
    const targetUser = l.targetType === "User" && l.targetId ? targetMap.get(l.targetId) : null;
    return {
      id: `audit:${l.id}`,
      type: l.action,
      category: (l.action.startsWith("user.password") || l.action.includes("password")) ? "SECURITY"
        : l.action.startsWith("profile.") ? "PROFILE"
        : l.action.startsWith("event.") ? "EVENT"
        : l.action.startsWith("form.") ? "FORM"
        : l.action.startsWith("attendance.") ? "ATTENDANCE"
        : l.action.startsWith("certificate.") ? "CERTIFICATE"
        : l.action.startsWith("user.") ? "ACCOUNT"
        : "ADMIN",
      createdAt: l.createdAt.toISOString(),
      titleKey: l.action,
      descriptionKey: l.action,
      descriptionParams: undefined,
      href: null,
      actor: l.actorId ? "ADMIN" : "SYSTEM",
      actorName: l.actor?.name ?? null,
      actorId: l.actorId,
      actorEmail: l.actor?.email ?? null,
      targetUserId: l.targetType === "User" ? l.targetId : null,
      targetName: targetUser?.name ?? null,
      targetEmail: targetUser?.email ?? null,
      targetType: l.targetType,
      targetId: l.targetId,
      details: undefined, // do not expose raw details by default in general list; can be extended carefully
    };
  }).filter((i) => !opts.category || i.category === opts.category);
  const nextCursor = hasMore && page.length ? page[page.length - 1].createdAt.toISOString() : null;
  return { items, hasMore, nextCursor };
}
