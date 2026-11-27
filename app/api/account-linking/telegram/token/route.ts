import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth-guards";
import { buildTelegramDeepLink, generateTelegramLinkToken, getTelegramBotUsername, isTelegramConfigured } from "@/lib/telegram-linking";
import { withApiErrorHandling } from "@/lib/api-error-handler";

async function POSTInternal() {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "Password change required" }, { status: 403 });
  if (user.telegramUserId) return NextResponse.json({ error: "Telegram is already linked." }, { status: 409 });

  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Telegram linking is not configured." }, { status: 503 });
  }
  const botUsername = getTelegramBotUsername();
  if (!botUsername) return NextResponse.json({ error: "Telegram linking is not configured." }, { status: 503 });

  const { token, tokenHash, expiresAt } = generateTelegramLinkToken();
  await prisma.$transaction([
    prisma.telegramLinkToken.deleteMany({ where: { userId: user.id, consumedAt: null } }),
    prisma.telegramLinkToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
  ]);

  return NextResponse.json({
    deepLink: buildTelegramDeepLink(botUsername, token),
    expiresAt: expiresAt.toISOString(),
    botUsername,
  });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/account-linking/telegram/token");
