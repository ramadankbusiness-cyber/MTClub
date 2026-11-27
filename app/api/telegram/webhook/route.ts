import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashTelegramLinkToken, sendTelegramMessage, verifyTelegramWebhookSecret } from "@/lib/telegram-linking";
import { withApiErrorHandling } from "@/lib/api-error-handler";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id: number; type?: string };
    from?: { id: number; username?: string };
  };
};

async function POSTInternal(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramWebhookSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = await request.json().catch(() => null) as TelegramUpdate | null;
  const message = update?.message;
  const text = message?.text?.trim();
  const chat = message?.chat;
  const from = message?.from;

  if (!text || !chat || !from) return NextResponse.json({ ok: true, ignored: true });
  if (chat.type !== "private") return NextResponse.json({ ok: true, ignored: true });

  const match = text.match(/^\/start(?:\s+([A-Za-z0-9_-]+))?$/);
  if (!match) return NextResponse.json({ ok: true, ignored: true });
  const token = match[1];
  if (!token) {
    await sendTelegramMessage(chat.id, "Please use the account linking link from the MT Club website to connect your Telegram account.");
    return NextResponse.json({ ok: true });
  }

  const tokenHash = hashTelegramLinkToken(token);
  const now = new Date();
  const telegramUserId = String(from.id);
  const telegramUsername = typeof from.username === "string" ? from.username.slice(0, 64) : null;
  const telegramChatId = String(chat.id);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const linkToken = await tx.telegramLinkToken.findUnique({ where: { tokenHash } });
      if (!linkToken) return { status: "invalid" as const };
      if (linkToken.consumedAt) return { status: "used" as const };
      if (linkToken.expiresAt.getTime() <= now.getTime()) return { status: "expired" as const };

      const existingTelegramOwner = await tx.user.findUnique({ where: { telegramUserId }, select: { id: true } });
      if (existingTelegramOwner && existingTelegramOwner.id !== linkToken.userId) {
        return { status: "telegram_already_linked" as const };
      }

      const targetUser = await tx.user.findUnique({ where: { id: linkToken.userId }, select: { id: true, telegramUserId: true } });
      if (!targetUser) return { status: "invalid" as const };
      if (targetUser.telegramUserId && targetUser.telegramUserId !== telegramUserId) {
        return { status: "user_already_linked" as const };
      }

      const consumed = await tx.telegramLinkToken.updateMany({
        where: { id: linkToken.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return { status: "used" as const };

      await tx.user.update({
        where: { id: linkToken.userId },
        data: {
          telegramUserId,
          telegramUsername,
          telegramChatId,
          telegramLinkedAt: now,
        },
      });

      await tx.telegramLinkToken.deleteMany({ where: { userId: linkToken.userId, consumedAt: null, id: { not: linkToken.id } } });
      return { status: "linked" as const };
    });

    const messages: Record<string, string> = {
      linked: "Your Telegram account has been linked to MT Club. You can return to the website.",
      invalid: "This linking link is invalid. Please generate a new one from the MT Club website.",
      used: "This linking link has already been used. Please generate a new one from the MT Club website.",
      expired: "This linking link has expired. Please generate a new one from the MT Club website.",
      telegram_already_linked: "This Telegram account is already linked to a different MT Club account.",
      user_already_linked: "This MT Club account is already linked to a different Telegram account.",
    };
    await sendTelegramMessage(chat.id, messages[result.status] ?? messages.invalid);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    console.error("[TelegramWebhook] Failed to process update", { name: (error as Error)?.name });
    await sendTelegramMessage(chat.id, "Could not link your account right now. Please try again from the MT Club website.");
    return NextResponse.json({ ok: true, status: "error" });
  }
}

export const POST = withApiErrorHandling(POSTInternal, "/api/telegram/webhook");
