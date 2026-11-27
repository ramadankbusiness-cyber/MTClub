import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TELEGRAM_LINK_TTL_MS = 10 * 60 * 1000;

export function getTelegramBotUsername() {
  const value = process.env.TELEGRAM_BOT_USERNAME?.trim();
  return value ? value.replace(/^@/, "") : null;
}

export function getTelegramBotToken() {
  const value = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return value || null;
}

export function getTelegramWebhookSecret() {
  const value = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return value || null;
}

export function isTelegramConfigured() {
  return !!getTelegramBotUsername() && !!getTelegramWebhookSecret();
}

export function generateTelegramLinkToken() {
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash, expiresAt: new Date(Date.now() + TELEGRAM_LINK_TTL_MS) };
}

export function hashTelegramLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildTelegramDeepLink(username: string, token: string) {
  return `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`;
}

export function verifyTelegramWebhookSecret(headerValue: string | null) {
  const expected = getTelegramWebhookSecret();
  if (!expected || !headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendTelegramMessage(chatId: string | number, text: string) {
  const token = getTelegramBotToken();
  if (!token) return { ok: false as const, skipped: true as const };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    cache: "no-store",
  });
  if (!response.ok) return { ok: false as const, skipped: false as const };
  return { ok: true as const, skipped: false as const };
}
