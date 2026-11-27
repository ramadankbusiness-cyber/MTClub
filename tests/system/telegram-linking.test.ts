import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  prisma: {
    telegramLinkToken: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  sendTelegramMessage: vi.fn(async () => ({ ok: true, skipped: false })),
  verifyTelegramWebhookSecret: vi.fn(() => true),
  hashTelegramLinkToken: vi.fn((t: string) => `hash:${t}`),
  isTelegramConfigured: vi.fn(() => true),
  getTelegramBotUsername: vi.fn(() => "mtclub_bot"),
  generateTelegramLinkToken: vi.fn(() => ({ token: "tok", tokenHash: "hash:tok", expiresAt: new Date(Date.now() + 600000) })),
  buildTelegramDeepLink: vi.fn((u: string, t: string) => `https://t.me/${u}?start=${t}`),
}));

vi.mock("@/lib/auth-guards", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/telegram-linking", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
  verifyTelegramWebhookSecret: mocks.verifyTelegramWebhookSecret,
  hashTelegramLinkToken: mocks.hashTelegramLinkToken,
  isTelegramConfigured: mocks.isTelegramConfigured,
  getTelegramBotUsername: mocks.getTelegramBotUsername,
  generateTelegramLinkToken: mocks.generateTelegramLinkToken,
  buildTelegramDeepLink: mocks.buildTelegramDeepLink,
}));

import { POST as webhookPOST } from "@/app/api/telegram/webhook/route";
import { POST as tokenPOST } from "@/app/api/account-linking/telegram/token/route";

describe("Telegram linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTelegramWebhookSecret.mockReturnValue(true);
    mocks.getCurrentUser.mockResolvedValue({ id: "u1", isActive: true, mustChangePassword: false, telegramUserId: null });
    mocks.isTelegramConfigured.mockReturnValue(true);
    mocks.getTelegramBotUsername.mockReturnValue("mtclub_bot");
  });

  it("rejects invalid webhook secret", async () => {
    mocks.verifyTelegramWebhookSecret.mockReturnValue(false);
    const res = await webhookPOST(new Request("http://localhost/api/telegram/webhook", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(401);
  });

  it("links successfully with valid token", async () => {
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb({
      telegramLinkToken: {
        findUnique: vi.fn(async () => ({ id: "t1", userId: "u1", consumedAt: null, expiresAt: new Date(Date.now() + 60000) })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null) // existingTelegramOwner
          .mockResolvedValueOnce({ id: "u1", telegramUserId: null }), // targetUser
        update: vi.fn(async () => ({})),
      },
    }));
    const res = await webhookPOST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify({ message: { text: "/start tok", chat: { id: 10, type: "private" }, from: { id: 99, username: "tg" } } }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("linked");
  });

  it("rejects invalid token", async () => {
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb({
      telegramLinkToken: { findUnique: vi.fn(async () => null) },
      user: { findUnique: vi.fn() },
    }));
    const res = await webhookPOST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify({ message: { text: "/start bad", chat: { id: 10, type: "private" }, from: { id: 99 } } }) }));
    expect((await res.json()).status).toBe("invalid");
  });

  it("rejects expired token", async () => {
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb({
      telegramLinkToken: { findUnique: vi.fn(async () => ({ id: "t1", userId: "u1", consumedAt: null, expiresAt: new Date(Date.now() - 1000) })) },
      user: { findUnique: vi.fn() },
    }));
    const res = await webhookPOST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify({ message: { text: "/start tok", chat: { id: 10, type: "private" }, from: { id: 99 } } }) }));
    expect((await res.json()).status).toBe("expired");
  });

  it("rejects reused token", async () => {
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb({
      telegramLinkToken: { findUnique: vi.fn(async () => ({ id: "t1", userId: "u1", consumedAt: new Date(), expiresAt: new Date(Date.now() + 60000) })) },
      user: { findUnique: vi.fn() },
    }));
    const res = await webhookPOST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify({ message: { text: "/start tok", chat: { id: 10, type: "private" }, from: { id: 99 } } }) }));
    expect((await res.json()).status).toBe("used");
  });

  it("rejects already-linked Telegram identity", async () => {
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => cb({
      telegramLinkToken: { findUnique: vi.fn(async () => ({ id: "t1", userId: "u1", consumedAt: null, expiresAt: new Date(Date.now() + 60000) })) },
      user: { findUnique: vi.fn(async () => ({ id: "u2" })) }, // existingTelegramOwner different
    }));
    const res = await webhookPOST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "s" }, body: JSON.stringify({ message: { text: "/start tok", chat: { id: 10, type: "private" }, from: { id: 99 } } }) }));
    expect((await res.json()).status).toBe("telegram_already_linked");
  });

  it("rejects unauthorized token generation attempt", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await tokenPOST();
    expect(res.status).toBe(401);
  });

  it("allows authenticated incomplete user to generate token (linking endpoint accessible)", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u1", isActive: true, mustChangePassword: false, telegramUserId: null, googleSubject: null });
    mocks.prisma.$transaction.mockResolvedValue([]);
    const res = await tokenPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deepLink).toContain("t.me/mtclub_bot");
  });
});
