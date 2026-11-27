import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_LINK_COOKIE = "mt_google_link";
export const GOOGLE_LINK_TTL_MS = 10 * 60 * 1000;

type GoogleLinkState = {
  uid: string;
  nonce: string;
  exp: number;
  returnTo: string;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or too short.");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function createGoogleLinkState(userId: string, returnTo = "/en/account-linking") {
  const payload: GoogleLinkState = {
    uid: userId,
    nonce: randomBytes(16).toString("base64url"),
    exp: Date.now() + GOOGLE_LINK_TTL_MS,
    returnTo,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyGoogleLinkState(token: string | undefined, expectedUserId: string): GoogleLinkState | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GoogleLinkState;
    if (payload.uid !== expectedUserId) return null;
    if (!payload.nonce || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.returnTo !== "string" || !payload.returnTo.startsWith("/")) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function buildGoogleAuthUrl(params: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export async function exchangeGoogleCode(params: { code: string; clientId: string; clientSecret: string; redirectUri: string }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null) as { access_token?: string; error?: string } | null;
  if (!response.ok || !data?.access_token) {
    return { ok: false as const, error: data?.error ?? "token_exchange_failed" };
  }
  return { ok: true as const, accessToken: data.access_token };
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null) as { sub?: string; email?: string; email_verified?: boolean; name?: string } | null;
  if (!response.ok || !data?.sub) return null;
  return {
    sub: String(data.sub),
    email: typeof data.email === "string" ? data.email.toLowerCase() : null,
    emailVerified: data.email_verified === true,
    name: typeof data.name === "string" ? data.name : null,
  };
}
