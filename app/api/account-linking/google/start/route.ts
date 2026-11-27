import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-guards";
import { buildGoogleAuthUrl, createGoogleLinkState, getGoogleOAuthConfig, GOOGLE_LINK_COOKIE, GOOGLE_LINK_TTL_MS } from "@/lib/google-linking";
import { withApiErrorHandling } from "@/lib/api-error-handler";

function safeReturnTo(value: string | null) {
  if (!value) return "/en/account-linking";
  if (!value.startsWith("/") || value.startsWith("//")) return "/en/account-linking";
  return value;
}

function redirectBack(url: URL, returnTo: string, google: string) {
  const target = new URL(returnTo, url.origin);
  target.searchParams.set("google", google);
  return NextResponse.redirect(target);
}

async function GETInternal(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("message", "login-required");
    return NextResponse.redirect(loginUrl);
  }
  if (user.mustChangePassword) {
    return NextResponse.redirect(new URL("/change-password", url.origin));
  }

  const config = getGoogleOAuthConfig();
  if (!config) {
    return redirectBack(url, returnTo, "not_configured");
  }

  if (user.googleSubject) {
    return redirectBack(url, returnTo, "already_linked_self");
  }

  const redirectUri = new URL("/api/account-linking/google/callback", url.origin).toString();
  const state = createGoogleLinkState(user.id, returnTo);
  const authUrl = buildGoogleAuthUrl({ clientId: config.clientId, redirectUri, state });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GOOGLE_LINK_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/api/account-linking/google",
    maxAge: Math.floor(GOOGLE_LINK_TTL_MS / 1000),
  });
  return response;
}

export const GET = withApiErrorHandling(GETInternal, "/api/account-linking/google/start");
