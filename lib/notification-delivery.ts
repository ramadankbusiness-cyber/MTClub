import { sendNotification, setVapidDetails } from "web-push";
import { NotificationType, type NotificationType as NotificationTypeValue } from "@/lib/db-enums";
import type { Prisma } from "@/lib/generated/prisma";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { countUnexcusedAbsences, getAbsenceWarningThreshold } from "@/lib/attendance";

export async function dispatchPushNotification(notificationId: string) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return { configured: false, sent: 0 };
  setVapidDetails(subject, publicKey, privateKey);

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, title: true, titleAr: true, message: true, messageAr: true, link: true, type: true },
  });
  if (!notification) return { configured: true, sent: 0 };
  const recipients = await prisma.notificationRecipient.findMany({
    where: { notificationId, pushSentAt: null, pushAttempts: { lt: 5 } },
    include: {
      user: {
        select: {
          pushSubscriptions: true,
          preferredLanguage: true,
          notificationPreferences: { where: { type: notification.type }, select: { push: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const recipient of recipients) {
    const preference = recipient.user.notificationPreferences[0];
    if (preference?.push === false || !recipient.user.pushSubscriptions.length) {
      await prisma.notificationRecipient.update({
        where: { id: recipient.id },
        data: { pushSentAt: new Date() },
      });
      continue;
    }

    let delivered = false;
    for (const subscription of recipient.user.pushSubscriptions) {
      try {
        await sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify({
            title: recipient.user.preferredLanguage === "ar" ? notification.titleAr || notification.title : notification.title,
            body: recipient.user.preferredLanguage === "ar" ? notification.messageAr || notification.message : notification.message,
            url: notification.link ?? "/notifications",
            tag: notification.id,
          }),
        );
        delivered = true;
      } catch (error) {
        const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } });
        } else {
          console.error("[Push delivery] Send failed", { subscriptionId: subscription.id, statusCode });
        }
      }
    }
    await prisma.notificationRecipient.update({
      where: { id: recipient.id },
      data: {
        pushAttempts: { increment: 1 },
        pushSentAt: delivered ? new Date() : null,
      },
    });
    if (delivered) sent += 1;
  }
  return { configured: true, sent };
}

export async function dispatchDueNotifications(now = new Date()) {
  const due = await prisma.notification.findMany({
    where: { sentAt: null, scheduledAt: { lte: now } },
    take: 100,
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });
  let sent = 0;
  for (const notification of due) {
    await prisma.$transaction(async (transaction) => {
      await transaction.notificationRecipient.updateMany({
        where: { notificationId: notification.id, deliveredAt: null },
        data: { deliveredAt: now },
      });
      await transaction.notification.update({ where: { id: notification.id }, data: { sentAt: now } });
    });
    await dispatchPushNotification(notification.id);
    sent += 1;
  }
  return sent;
}

export async function createImmediateNotification(input: {
  title: string;
  titleAr?: string | null;
  message: string;
  messageAr?: string | null;
  link: string;
  type: NotificationTypeValue;
  audience: "EVERYONE" | "COMMITTEE" | "USERS";
  committeeId: string | null;
  createdById?: string | null;
  userIds?: string[];
}) {
  const now = new Date();
  const { userIds, ...notificationData } = input;
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(input.audience === "COMMITTEE" && input.committeeId ? { committeeId: input.committeeId } : {}),
      ...(input.audience === "USERS" ? { id: { in: userIds ?? [] } } : {}),
    },
    select: { id: true, notificationPreferences: { where: { type: input.type }, select: { inApp: true, push: true } } },
  });
  const recipients = users.filter((user) => {
    const preference = user.notificationPreferences[0];
    return preference?.inApp !== false || preference?.push !== false;
  });
  const notification = await prisma.$transaction(async (transaction) => {
    const created = await transaction.notification.create({
      data: {
        ...notificationData,
        sentAt: now,
      },
    });
    if (recipients.length) {
      await insertNotificationRecipients(
        transaction,
        recipients.map((user) => ({ notificationId: created.id, userId: user.id, deliveredAt: now })),
      );
    }
    return created;
  });
  await dispatchPushNotification(notification.id);
  return notification;
}

export async function dispatchOperationalReminders(now = new Date()) {
  const reminders = [
    { hours: 24, label: "24-hour reminder" },
    { hours: 1, label: "1-hour reminder" },
  ];
  let created = 0;
  for (const reminder of reminders) {
    const threshold = now.getTime() + reminder.hours * 60 * 60 * 1000;
    const events = await prisma.event.findMany({
      where: {
        published: true,
        archivedAt: null,
        startsAt: { gt: new Date(threshold - 2 * 60_000), lte: new Date(threshold) },
      },
      select: { id: true, title: true, titleAr: true, startsAt: true, committeeId: true, createdById: true },
    });
    for (const event of events) {
      const link = `/events?event=${encodeURIComponent(event.id)}&reminder=${reminder.hours}h`;
      const exists = await prisma.notification.findFirst({ where: { type: "EVENT_REMINDER", link }, select: { id: true } });
      if (exists) continue;
      const recipients = await prisma.user.findMany({
        where: { isActive: true, ...(event.committeeId ? { committeeId: event.committeeId } : {}) },
        select: { id: true, notificationPreferences: { where: { type: "EVENT_REMINDER" }, select: { inApp: true, push: true } } },
      });
      const deliverable = recipients.filter((user) => {
        const preference = user.notificationPreferences[0];
        return preference?.inApp !== false || preference?.push !== false;
      });
      const notification = await prisma.$transaction(async (transaction) => {
        const createdNotification = await transaction.notification.create({
          data: {
            title: `${reminder.label}: ${event.title}`,
            titleAr: `تذكير: ${event.titleAr || event.title}`,
            message: `“${event.title}” starts ${reminder.hours === 1 ? "in one hour" : "in 24 hours"}.`,
            messageAr: `يبدأ موعد "${event.titleAr || event.title}" ${reminder.hours === 1 ? "بعد ساعة" : "خلال 24 ساعة"}.`,
            link,
            type: "EVENT_REMINDER",
            audience: event.committeeId ? "COMMITTEE" : "EVERYONE",
            committeeId: event.committeeId,
            createdById: event.createdById,
            sentAt: now,
          },
        });
        if (deliverable.length) {
          await insertNotificationRecipients(
            transaction,
            deliverable.map((user) => ({ notificationId: createdNotification.id, userId: user.id, deliveredAt: now })),
          );
        }
        return createdNotification;
      });
      await dispatchPushNotification(notification.id);
      created += 1;
    }
  }

  const sessions = await prisma.attendanceSession.findMany({
    where: {
      startsAt: { gt: new Date(now.getTime() - 2 * 60_000), lte: now },
      endsAt: { gt: now },
      OR: [
        { origin: "MANUAL" },
        { origin: "EVENT", eventId: { not: null }, event: { archivedAt: null } },
      ],
    },
    select: { id: true, title: true, committeeId: true, createdById: true },
  });
  for (const session of sessions) {
    const link = `/dashboard?session=${encodeURIComponent(session.id)}`;
    const exists = await prisma.notification.findFirst({ where: { type: "SESSION_OPENED", link }, select: { id: true } });
    if (exists) continue;
    const recipients = await prisma.user.findMany({
      where: { isActive: true, ...(session.committeeId ? { committeeId: session.committeeId } : {}) },
      select: { id: true, notificationPreferences: { where: { type: "SESSION_OPENED" }, select: { inApp: true, push: true } } },
    });
    const deliverable = recipients.filter((user) => {
      const preference = user.notificationPreferences[0];
      return preference?.inApp !== false || preference?.push !== false;
    });
    const notification = await prisma.$transaction(async (transaction) => {
      const createdNotification = await transaction.notification.create({
        data: {
          title: "Attendance is open",
          message: `Check-in is now open for ${session.title}.`,
          link,
          type: "SESSION_OPENED",
          audience: session.committeeId ? "COMMITTEE" : "EVERYONE",
          committeeId: session.committeeId,
          createdById: session.createdById,
          sentAt: now,
        },
      });
      if (deliverable.length) {
        await insertNotificationRecipients(
          transaction,
          deliverable.map((user) => ({ notificationId: createdNotification.id, userId: user.id, deliveredAt: now })),
        );
      }
      return createdNotification;
    });
    await dispatchPushNotification(notification.id);
    created += 1;
  }

  const warningThreshold = getAbsenceWarningThreshold();
  const completedSessions = await prisma.attendanceSession.findMany({
    where: { endsAt: { lte: now } },
    select: { id: true, committeeId: true, createdById: true, startsAt: true },
    orderBy: { startsAt: "desc" },
  });
  const participants = await prisma.user.findMany({
    where: { isActive: true, role: "MEMBER" },
    select: {
      id: true,
      committeeId: true,
      createdAt: true,
      attendance: {
        where: { session: { endsAt: { lte: now } } },
        select: { sessionId: true, status: true },
      },
    },
  });
  for (const participant of participants) {
    const eligibleSessions = completedSessions.filter(
      (session) => session.startsAt >= participant.createdAt
        && (!session.committeeId || session.committeeId === participant.committeeId),
    );
    if (!eligibleSessions.length) continue;
    const absenceCount = countUnexcusedAbsences(
      eligibleSessions.map((session) => session.id),
      participant.attendance,
    );
    if (absenceCount < warningThreshold) continue;
    const warningKey = createHash("sha256").update(participant.id).digest("hex").slice(0, 20);
    const link = `/attendance?warning=${warningKey}`;
    const exists = await prisma.notification.findFirst({
      where: { type: "ABSENCE_WARNING", link },
      select: { id: true },
    });
    if (exists) continue;
    await createImmediateNotification({
      title: "Attendance needs attention",
      message: `You have ${absenceCount} unexcused absences, reaching the club warning threshold of ${warningThreshold}.`,
      link,
      type: "ABSENCE_WARNING",
      audience: "USERS",
      committeeId: null,
      createdById: eligibleSessions[0].createdById,
      userIds: [participant.id],
    });
    created += 1;
  }
  return created;
}

export function isNotificationType(value: string): value is NotificationTypeValue {
  return Object.values(NotificationType).includes(value as NotificationTypeValue);
}

export async function insertNotificationRecipients(
  transaction: Prisma.TransactionClient,
  recipients: Array<{ notificationId: string; userId: string; deliveredAt: Date | null }>,
) {
  await Promise.all(recipients.map(({ notificationId, userId, deliveredAt }) =>
    transaction.notificationRecipient.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId, deliveredAt },
      update: { deliveredAt },
    }),
  ));
}

export async function countUnreadForUser(userId: string) {
  const rows = await prisma.notificationRecipient.findMany({
    where: { userId, readAt: null, deliveredAt: { not: null } },
    select: {
      notification: { select: { type: true } },
      user: { select: { notificationPreferences: { select: { type: true, inApp: true } } } },
    },
  });
  return rows.filter((row) => row.user.notificationPreferences.find((preference) => preference.type === row.notification.type)?.inApp !== false).length;
}
