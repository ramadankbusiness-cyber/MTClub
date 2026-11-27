import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-error-handler";

async function GETInternal() {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    googleLinked: !!user.googleSubject,
    googleEmail: user.googleEmail,
    telegramLinked: !!user.telegramUserId,
    telegramUsername: user.telegramUsername,
    complete: !!user.googleSubject && !!user.telegramUserId,
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/account-linking/status");
