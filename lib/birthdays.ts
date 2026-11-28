import { prisma } from "@/lib/prisma";
import { dispatchPushNotification, insertNotificationRecipients } from "@/lib/notification-delivery";
import { NotificationType } from "@/lib/db-enums";

const STALE_PROCESSING_MS = 15 * 60 * 1000;
const BATCH_SIZE = 200;

function getTimeZone() {
  const tz = process.env.BIRTHDAY_TIMEZONE?.trim();
  return tz || "Africa/Cairo";
}

function getMonthDay(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "2-digit", day: "2-digit", year: "numeric" }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  return { month, day, year };
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

type Candidate = { id: string; name: string; preferredLanguage: string | null };

async function fetchCandidates(month: number, day: number, year: number) {
  const targetDays: Array<{ month: number; day: number }> = [{ month, day }];
  if (month === 2 && day === 28 && !isLeapYear(year)) targetDays.push({ month: 2, day: 29 });

  try {
    if (targetDays.length > 1) {
      return await prisma.$queryRaw<Candidate[]>`
        SELECT "id", "name", "preferredLanguage"
        FROM "User"
        WHERE "isActive" = true
          AND "dateOfBirth" IS NOT NULL
          AND (
            (EXTRACT(MONTH FROM "dateOfBirth") = ${month} AND EXTRACT(DAY FROM "dateOfBirth") = ${day})
            OR (EXTRACT(MONTH FROM "dateOfBirth") = 2 AND EXTRACT(DAY FROM "dateOfBirth") = 29)
          )
        ORDER BY "id" ASC
      `;
    }
    return await prisma.$queryRaw<Candidate[]>`
      SELECT "id", "name", "preferredLanguage"
      FROM "User"
      WHERE "isActive" = true
        AND "dateOfBirth" IS NOT NULL
        AND EXTRACT(MONTH FROM "dateOfBirth") = ${month}
        AND EXTRACT(DAY FROM "dateOfBirth") = ${day}
      ORDER BY "id" ASC
    `;
  } catch {
    const users = await prisma.user.findMany({
      where: { isActive: true, dateOfBirth: { not: null } },
      select: { id: true, name: true, preferredLanguage: true, dateOfBirth: true },
      orderBy: { id: "asc" },
    });
    return users.filter((u) => {
      const dob = u.dateOfBirth;
      if (!dob) return false;
      const m = dob.getUTCMonth() + 1;
      const d = dob.getUTCDate();
      return targetDays.some((t) => t.month === m && t.day === d);
    }).map(({ id, name, preferredLanguage }) => ({ id, name, preferredLanguage }));
  }
}

async function claimOrSkip(userId: string, year: number, now: Date) {
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS);
  const existing = await prisma.birthdayDelivery.findUnique({ where: { userId_year: { userId, year } } });
  if (existing?.status === "SENT") return { action: "skip" as const, deliveryId: existing.id };
  if (existing?.status === "PENDING" && existing.claimedAt > staleBefore) return { action: "skip" as const, deliveryId: existing.id };
  if (existing?.status === "FAILED" && existing.claimedAt > staleBefore) return { action: "skip" as const, deliveryId: existing.id };

  if (existing) {
    const claimed = await prisma.birthdayDelivery.updateMany({
      where: { id: existing.id, status: existing.status, claimedAt: existing.claimedAt },
      data: { status: "PENDING", claimedAt: now, lastError: null },
    });
    if (claimed.count === 0) return { action: "skip" as const, deliveryId: existing.id };
    return { action: "process" as const, deliveryId: existing.id };
  }

  try {
    const created = await prisma.birthdayDelivery.create({ data: { userId, year, status: "PENDING", claimedAt: now } });
    return { action: "process" as const, deliveryId: created.id };
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (code === "P2002") return { action: "skip" as const, deliveryId: "" };
    throw e;
  }
}

export async function dispatchBirthdayNotifications(now = new Date()) {
  const timeZone = getTimeZone();
  const { month, day, year } = getMonthDay(now, timeZone);
  if (!month || !day || !year) return { checked: 0, sent: 0, skipped: 0, failed: 0, year: 0, timeZone };

  const candidates = await fetchCandidates(month, day, year);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    for (const user of batch) {
      const claim = await claimOrSkip(user.id, year, now);
      if (claim.action === "skip") { skipped += 1; continue; }

      try {
        const notificationId = await prisma.$transaction(async (tx) => {
          const recipient = await tx.user.findUnique({
            where: { id: user.id },
            select: { id: true, isActive: true, notificationPreferences: { where: { type: NotificationType.BIRTHDAY }, select: { inApp: true, push: true } } },
          });
          if (!recipient?.isActive) {
            await tx.birthdayDelivery.update({ where: { id: claim.deliveryId }, data: { status: "FAILED", lastError: "inactive", updatedAt: now } });
            return null;
          }
          const pref = recipient.notificationPreferences[0];
          const enabled = pref?.inApp !== false || pref?.push !== false;
          if (!enabled) {
            await tx.birthdayDelivery.update({ where: { id: claim.deliveryId }, data: { status: "SENT", sentAt: now, lastError: null, updatedAt: now } });
            return null;
          }
          const notification = await tx.notification.create({
            data: {
              title: `Happy birthday, ${user.name}!`,
              titleAr: `عيد ميلاد سعيد، ${user.name}!`,
              message: "Wishing you a wonderful year ahead from the MT Club family.",
              messageAr: "نتمنى لك عامًا رائعًا من عائلة نادي MT.",
              link: "/profile",
              type: NotificationType.BIRTHDAY,
              audience: "USERS",
              committeeId: null,
              createdById: null,
              sentAt: now,
            },
          });
          await insertNotificationRecipients(tx, [{ notificationId: notification.id, userId: user.id, deliveredAt: now }]);
          await tx.birthdayDelivery.update({
            where: { id: claim.deliveryId },
            data: { status: "SENT", notificationId: notification.id, sentAt: now, lastError: null, updatedAt: now },
          });
          return notification.id;
        });

        if (notificationId) {
          await dispatchPushNotification(notificationId).catch(() => {});
          sent += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 500) : "unknown";
        await prisma.birthdayDelivery.update({ where: { id: claim.deliveryId }, data: { status: "FAILED", lastError: message, claimedAt: new Date(0), updatedAt: new Date() } }).catch(() => {});
        failed += 1;
      }
    }
  }

  return { checked: candidates.length, sent, skipped, failed, year, timeZone };
}
