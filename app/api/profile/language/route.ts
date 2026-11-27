import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-error-handler";

const languageSchema = z.object({ preferredLanguage: z.enum(["en", "ar"]) });

async function PATCHInternal(request: Request) {
  const access = await requirePermission("profile.update.own");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body: unknown = await request.json().catch(() => null);
  const parsed = languageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a supported language." }, { status: 400 });
  await prisma.user.update({
    where: { id: access.user.id },
    data: { preferredLanguage: parsed.data.preferredLanguage },
    select: { id: true },
  });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrorHandling(PATCHInternal, "/api/profile/language");
