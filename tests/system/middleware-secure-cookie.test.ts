import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
}));
const intlResponse = new Response(null, { status: 200, headers: { "x-intl": "1" } });

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }));
vi.mock("next-intl/middleware", () => ({
  default: () => () => intlResponse,
}));
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["en", "ar"] },
}));
vi.mock("@/lib/login", () => ({
  removeLocalePrefix: (value: string) => value.replace(/^\/(en|ar)(?=\/|$)/, "") || "/",
  safeReturnPath: (value: string | null | undefined) => (value && value.startsWith("/") ? value : null),
}));

import { middleware } from "@/middleware";

function makeRequest(url: string) {
  return new NextRequest(url);
}

describe("middleware auth token cookie security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
    process.env.AUTH_URL = "https://mtclub.vercel.app";
  });

  it("uses secure cookies for HTTPS protected-route requests", async () => {
    getTokenMock.mockResolvedValue({ id: "u1", mustChangePassword: false, sessionVersion: 1, googleLinked: true, telegramLinked: true });

    const response = await middleware(makeRequest("https://mtclub.vercel.app/en/dashboard"));

    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-intl")).toBe("1");
  });

  it("redirects unauthenticated protected-route HTTPS requests to login using secure cookie token lookup", async () => {
    getTokenMock.mockResolvedValue(null);

    const response = await middleware(makeRequest("https://mtclub.vercel.app/en/dashboard"));

    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/en/login");
  });
});
