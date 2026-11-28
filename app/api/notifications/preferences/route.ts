import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { NotificationType } from "@/lib/db-enums";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { notificationPreferenceSchema } from "@/lib/schemas";

async function GETInternal() {
  const access = await requirePermission("notifications.manage.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const saved = await prisma.notificationPreference.findMany({ where: { userId: access.user.id } });
  return NextResponse.json({
    preferences: Object.values(NotificationType).map((type) => ({
      type,
      inApp: saved.find((item) => item.type === type)?.inApp ?? true,
      push: saved.find((item) => item.type === type)?.push ?? true,
    })),
  });
}

const MANDATORY_IN_APP_TYPES = new Set(["ACCOUNT_CREATED", "PASSWORD_CHANGED", "ROLE_CHANGED"]);

async function PATCHInternal(request: Request) {
  const access = await requirePermission("notifications.manage.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = notificationPreferenceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check your notification preferences." }, { status: 400 });
  const inApp = MANDATORY_IN_APP_TYPES.has(parsed.data.type) ? true : parsed.data.inApp;
  const preference = await prisma.notificationPreference.upsert({
    where: { userId_type: { userId: access.user.id, type: parsed.data.type } },
    create: { userId: access.user.id, type: parsed.data.type, inApp, push: parsed.data.push },
    update: { inApp, push: parsed.data.push },
  });
  return NextResponse.json({ preference });
}

export const GET = withApiErrorHandling(GETInternal, "/api/notifications/preferences");
export const PATCH = withApiErrorHandling(PATCHInternal, "/api/notifications/preferences");
