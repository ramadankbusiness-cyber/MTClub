import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }));
const intlResponse = new Response(null, { status: 200, headers: { "x-intl": "1" } });

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }));
vi.mock("next-intl/middleware", () => ({ default: () => () => intlResponse }));
vi.mock("@/i18n/routing", () => ({ routing: { locales: ["en", "ar"] } }));
vi.mock("@/lib/login", () => ({
  removeLocalePrefix: (value: string) => value.replace(/^\/(en|ar)(?=\/|$)/, "") || "/",
  safeReturnPath: (value: string | null | undefined) => (value && value.startsWith("/") ? value : null),
}));

import { middleware } from "@/middleware";

function req(url: string) { return new NextRequest(url); }

describe("middleware account linking gate", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456"; });

  it("redirects when both integrations missing", async () => {
    getTokenMock.mockResolvedValue({ id: "u1", mustChangePassword: false, googleLinked: false, telegramLinked: false });
    const res = await middleware(req("https://mtclub.vercel.app/en/dashboard"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/en/account-linking");
  });

  it("redirects when missing Google only", async () => {
    getTokenMock.mockResolvedValue({ id: "u1", mustChangePassword: false, googleLinked: false, telegramLinked: true });
    const res = await middleware(req("https://mtclub.vercel.app/en/dashboard"));
    expect(res.headers.get("location")).toContain("/en/account-linking");
  });

  it("redirects when missing Telegram only", async () => {
    getTokenMock.mockResolvedValue({ id: "u1", mustChangePassword: false, googleLinked: true, telegramLinked: false });
    const res = await middleware(req("https://mtclub.vercel.app/en/dashboard"));
    expect(res.headers.get("location")).toContain("/en/account-linking");
  });

  it("allows when both integrations linked", async () => {
    getTokenMock.mockResolvedValue({ id: "u1", mustChangePassword: false, googleLinked: true, telegramLinked: true });
    const res = await middleware(req("https://mtclub.vercel.app/en/dashboard"));
    expect(res.status).toBe(200);
  });

  it("allows account-linking page itself", async () => {
    getTokenMock.mockResolvedValue({ id: "u1", mustChangePassword: false, googleLinked: false, telegramLinked: false });
    const res = await middleware(req("https://mtclub.vercel.app/en/account-linking"));
    expect(res.status).toBe(200);
  });
});
