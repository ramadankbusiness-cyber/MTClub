import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { createTemporaryPassword } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";
import { userAdminUpdateSchema } from "@/lib/schemas";
import { dispatchPushNotification } from "@/lib/notification-delivery";
import { isClubCommitteeId } from "@/lib/committees";

type RouteContext = { params: Promise<{ id: string }> };

function duplicateFieldMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return null;
  const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
  const targets = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  if (targets.some((t) => t.includes("email"))) return "An account with that email already exists.";
  if (targets.some((t) => t.includes("academicNumber"))) return "An account with that academic number already exists.";
  if (targets.some((t) => t.includes("clubId"))) return "An account with that MT Club ID already exists.";
  return "This account conflicts with an existing record.";
}

async function PATCHInternal(request: Request, context: RouteContext) {
  const access = await requirePermission("users.update");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Choose a valid account change." }, { status: 400 });
  }
  const parsed = userAdminUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the account details and try again." }, { status: 400 });

  const existingUser = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, committeeId: true, position: true, isMTC: true },
  });
  if (!existingUser) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const data = parsed.data;
  const onlyIsActive = data.isActive !== undefined && Object.keys(data).every((k) => k === "isActive");
  if (onlyIsActive) {
    if (id === access.user.id) return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
    try {
      const updated = await prisma.user.update({
        where: { id },
        data: { isActive: data.isActive },
        select: { id: true, name: true, isActive: true },
      });
      await writeAuditLog({ actorId: access.user.id, action: data.isActive ? "user.activate" : "user.deactivate", targetType: "User", targetId: id });
      return NextResponse.json({ user: updated });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") return NextResponse.json({ error: "Account not found." }, { status: 404 });
      throw error;
    }
  }

  if (id === access.user.id && (data.role !== undefined || data.committeeId !== undefined || data.position !== undefined || data.isMTC !== undefined)) {
    // prevent changing own role/assignment; allow editing own identity fields via profile flows elsewhere
    return NextResponse.json({ error: "You cannot change your own role or assignment." }, { status: 400 });
  }

  const nextRole = data.role ?? existingUser.role;
  const nextCommitteeRaw = data.committeeId === undefined ? existingUser.committeeId : data.committeeId;
  const nextPosition = data.position ?? existingUser.position;
  const selectedCommittee = nextCommitteeRaw ? await prisma.committee.findUnique({ where: { id: nextCommitteeRaw }, select: { key: true } }) : null;
  const nextIsMTC = ((data.isMTC ?? existingUser.isMTC) || selectedCommittee?.key === "mtc");
  const nextCommitteeId = nextRole === "ADMIN" ? null : (nextCommitteeRaw ?? null);

  if (nextRole !== "ADMIN" && !nextCommitteeId && !nextIsMTC) {
    return NextResponse.json({ error: "Select a committee for this account." }, { status: 400 });
  }
  if (nextCommitteeId && !(await isClubCommitteeId(nextCommitteeId, { includeMTC: true }))) {
    return NextResponse.json({ error: "That committee does not exist." }, { status: 400 });
  }

  const roleChanged = nextRole !== existingUser.role || nextCommitteeId !== existingUser.committeeId || nextPosition !== existingUser.position || nextIsMTC !== existingUser.isMTC;

  const updateData: Record<string, unknown> = {
    role: nextRole,
    committeeId: nextCommitteeId,
    position: nextPosition,
    isMTC: nextIsMTC,
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone ?? null;
  if (data.academicNumber !== undefined) updateData.academicNumber = data.academicNumber ?? null;
  if (data.clubId !== undefined) updateData.clubId = data.clubId ?? null;
  if (data.isActive !== undefined) {
    if (id === access.user.id) return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
    updateData.isActive = data.isActive;
  }
  // Preserve existing behavior: role/assignment changes require password reset flow; identity/contact edits must not reset password/session unnecessarily.
  if (roleChanged) updateData.mustChangePassword = true;

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, name: true, email: true, role: true, position: true, isMTC: true, committeeId: true,
        phone: true, academicNumber: true, clubId: true, isActive: true, mustChangePassword: true,
      },
    });
    await writeAuditLog({
      actorId: access.user.id,
      action: roleChanged ? "user.role.change" : "user.update",
      targetType: "User",
      targetId: id,
      details: { role: nextRole, committeeId: nextCommitteeId, position: nextPosition, isMTC: nextIsMTC },
    });
    if (roleChanged) {
      const notification = await prisma.notification.create({
        data: {
          title: "Your MT Club role has changed",
          message: "An administrator updated your account role. Sign in again and set a new password to continue.",
          type: "ROLE_CHANGED",
          audience: "USERS",
          createdById: access.user.id,
          sentAt: new Date(),
          recipients: { create: { userId: id, deliveredAt: new Date() } },
        },
      });
      await dispatchPushNotification(notification.id);
    }
    return NextResponse.json({ user: updated });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") return NextResponse.json({ error: "Account not found." }, { status: 404 });
    const duplicate = duplicateFieldMessage(error);
    if (duplicate) return NextResponse.json({ error: duplicate }, { status: 409 });
    throw error;
  }
}

async function POSTInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("users.resetPassword");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  if (id === access.user.id) return NextResponse.json({ error: "Use the password page to change your own password." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  const temporaryPassword = createTemporaryPassword();
  const temporaryPasswordExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true, temporaryPasswordExpiresAt, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
  ]);
  await writeAuditLog({ actorId: access.user.id, action: "user.password.reset", targetType: "User", targetId: id });
  const notification = await prisma.notification.create({
    data: {
      title: "Your MT Club password was reset",
      message: "An administrator reset your password. Sign in with the temporary password and choose a new one.",
      type: "ACCOUNT_CREATED",
      audience: "USERS",
      createdById: access.user.id,
      sentAt: new Date(),
      recipients: { create: { userId: id, deliveredAt: new Date() } },
    },
  });
  await dispatchPushNotification(notification.id);
  return NextResponse.json({ temporaryPassword }, { headers: { "Cache-Control": "no-store" } });
}

async function DELETEInternal(_request: Request, context: RouteContext) {
  const access = await requirePermission("users.delete");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  if (id === access.user.id) return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  try {
    await prisma.user.delete({ where: { id } });
    await writeAuditLog({ actorId: access.user.id, action: "user.delete", targetType: "User", targetId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2003") {
      return NextResponse.json({ error: "Could not delete the account because it has linked records." }, { status: 409 });
    }
    throw error;
  }
}

export const PATCH = withApiErrorHandling(PATCHInternal, "/api/admin/users/[id]");
export const POST = withApiErrorHandling(POSTInternal, "/api/admin/users/[id]");
export const DELETE = withApiErrorHandling(DELETEInternal, "/api/admin/users/[id]");
