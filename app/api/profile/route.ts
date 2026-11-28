import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(40).optional().nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

function isRealDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

async function GETInternal() {
  const access = await requirePermission("profile.read.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ user: access.user });
}

async function PATCHInternal(request: Request) {
  const access = await requirePermission("profile.update.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check your profile details." }, { status: 400 });

  let dateOfBirth: Date | null | undefined = undefined;
  if (parsed.data.dateOfBirth !== undefined) {
    if (parsed.data.dateOfBirth === null || parsed.data.dateOfBirth === "") {
      dateOfBirth = null;
    } else {
      if (!isRealDate(parsed.data.dateOfBirth)) return NextResponse.json({ error: "Enter a valid date of birth." }, { status: 400 });
      const dob = new Date(parsed.data.dateOfBirth + "T00:00:00.000Z");
      const today = new Date();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      if (dob > todayUtc) return NextResponse.json({ error: "Date of birth cannot be in the future." }, { status: 400 });
      dateOfBirth = dob;
    }
  }

  const data: Record<string, unknown> = { name: parsed.data.name, phone: parsed.data.phone ?? null };
  if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth;
  const updated = await prisma.user.update({
    where: { id: access.user.id },
    data,
    select: { id: true, name: true, email: true, phone: true, photoUrl: true, role: true, dateOfBirth: true },
  });
  await writeAuditLog({ actorId: access.user.id, action: "profile.update", targetType: "User", targetId: access.user.id });
  return NextResponse.json({ user: updated });
}

export const GET = withApiErrorHandling(GETInternal, "/api/profile");
export const PATCH = withApiErrorHandling(PATCHInternal, "/api/profile");
