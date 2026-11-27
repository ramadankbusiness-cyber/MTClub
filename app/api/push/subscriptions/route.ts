import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { pushSubscriptionSchema } from "@/lib/schemas";

function safePushLogError(stage: string, error: unknown, extra?: Record<string, unknown>) {
  const err = error as { name?: string; message?: string; code?: string };
  console.error("[PushSubscriptions]", {
    stage,
    name: err?.name,
    code: err?.code,
    // Do not log endpoint/keys/subscription payloads or secrets.
    ...extra,
  });
}

async function POSTInternal(request: Request) {
  const access = await requirePermission("notifications.manage.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    safePushLogError("invalid_payload", null, { userId: access.user.id });
    return NextResponse.json({ error: "The browser push subscription is invalid." }, { status: 400 });
  }
  try {
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      create: {
        userId: access.user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
      update: {
        userId: access.user.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
      select: { id: true },
    });
    return NextResponse.json({ subscriptionId: subscription.id }, { status: 201 });
  } catch (error) {
    safePushLogError("persist_failed", error, { userId: access.user.id });
    return NextResponse.json({ error: "Could not save the push subscription." }, { status: 500 });
  }
}

async function DELETEInternal(request: Request) {
  const access = await requirePermission("notifications.manage.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("endpoint" in body) || typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "Choose a valid push subscription." }, { status: 400 });
  }
  try {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: access.user.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    safePushLogError("delete_failed", error, { userId: access.user.id });
    return NextResponse.json({ error: "Could not remove the push subscription." }, { status: 500 });
  }
}

export const POST = withApiErrorHandling(POSTInternal, "/api/push/subscriptions");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/push/subscriptions");
