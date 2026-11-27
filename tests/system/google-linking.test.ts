import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
  getGoogleOAuthConfig: vi.fn(() => ({ clientId: "id", clientSecret: "secret" })),
  exchangeGoogleCode: vi.fn(async () => ({ ok: true, accessToken: "at" })),
  fetchGoogleUserInfo: vi.fn(async () => ({ sub: "g1", email: "g@example.com", emailVerified: true, name: "G" })),
  verifyGoogleLinkState: vi.fn(() => ({ uid: "u1", nonce: "n", exp: Date.now() + 10000, returnTo: "/en/account-linking" })),
  createGoogleLinkState: vi.fn(() => "state"),
  buildGoogleAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?x=1"),
  GOOGLE_LINK_COOKIE: "mt_google_link",
  GOOGLE_LINK_TTL_MS: 600000,
}));

vi.mock("@/lib/auth-guards", () => ({ getCurrentUser: mocks.getCurrentUser, isAccountLinkingComplete: (u: any) => !!u?.googleSubject && !!u?.telegramUserId }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/google-linking", () => ({
  getGoogleOAuthConfig: mocks.getGoogleOAuthConfig,
  exchangeGoogleCode: mocks.exchangeGoogleCode,
  fetchGoogleUserInfo: mocks.fetchGoogleUserInfo,
  verifyGoogleLinkState: mocks.verifyGoogleLinkState,
  createGoogleLinkState: mocks.createGoogleLinkState,
  buildGoogleAuthUrl: mocks.buildGoogleAuthUrl,
  GOOGLE_LINK_COOKIE: mocks.GOOGLE_LINK_COOKIE,
  GOOGLE_LINK_TTL_MS: mocks.GOOGLE_LINK_TTL_MS,
}));

import { GET as callbackGET } from "@/app/api/account-linking/google/callback/route";
import { GET as startGET } from "@/app/api/account-linking/google/start/route";

function makeCallbackReq(params: Record<string,string>, cookie = "state") {
  const url = new URL("http://localhost/api/account-linking/google/callback");
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  return new Request(url.toString(), { headers: { cookie: `mt_google_link=${encodeURIComponent(cookie)}` } });
}

describe("Google linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "u1", isActive: true, mustChangePassword: false, googleSubject: null });
    mocks.getGoogleOAuthConfig.mockReturnValue({ clientId: "id", clientSecret: "secret" });
    mocks.verifyGoogleLinkState.mockReturnValue({ uid: "u1", nonce: "n", exp: Date.now() + 10000, returnTo: "/en/account-linking" });
    mocks.exchangeGoogleCode.mockResolvedValue({ ok: true, accessToken: "at" });
    mocks.fetchGoogleUserInfo.mockResolvedValue({ sub: "g1", email: "g@example.com", emailVerified: true, name: "G" });
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.prisma.user.update.mockResolvedValue({});
  });

  it("starts linking for authenticated user", async () => {
    const res = await startGET(new Request("http://localhost/api/account-linking/google/start?returnTo=%2Fen%2Faccount-linking"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("accounts.google.com");
  });

  it("rejects unauthorized start", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await startGET(new Request("http://localhost/api/account-linking/google/start?returnTo=%2Fen%2Faccount-linking"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("links successfully on valid callback", async () => {
    const res = await callbackGET(makeCallbackReq({ code: "c", state: "state" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("google=linked");
    expect(mocks.prisma.user.update).toHaveBeenCalled();
  });

  it("rejects invalid OAuth callback state", async () => {
    mocks.verifyGoogleLinkState.mockReturnValue(null);
    const res = await callbackGET(makeCallbackReq({ code: "c", state: "bad" }));
    expect(res.headers.get("location")).toContain("google=invalid_state");
  });

  it("rejects account ownership conflict", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "u2" });
    const res = await callbackGET(makeCallbackReq({ code: "c", state: "state" }));
    expect(res.headers.get("location")).toContain("google=already_linked");
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("handles existing linked account on current user", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u1", isActive: true, mustChangePassword: false, googleSubject: "old-sub" });
    const res = await callbackGET(makeCallbackReq({ code: "c", state: "state" }));
    expect(res.headers.get("location")).toContain("google=already_linked_self");
  });
});
