import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth-guards";
import { exchangeGoogleCode, fetchGoogleUserInfo, getGoogleOAuthConfig, GOOGLE_LINK_COOKIE, verifyGoogleLinkState } from "@/lib/google-linking";
import { withApiErrorHandling } from "@/lib/api-error-handler";

function redirectWith(url: URL, returnTo: string, params: Record<string, string>) {
  const target = new URL(returnTo.startsWith("/") ? returnTo : "/en/account-linking", url.origin);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  const response = NextResponse.redirect(target);
  response.cookies.set(GOOGLE_LINK_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/api/account-linking/google", maxAge: 0 });
  return response;
}

async function GETInternal(request: Request) {
  const url = new URL(request.url);
  const returnTo = "/en/account-linking";
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("message", "login-required");
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set(GOOGLE_LINK_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/api/account-linking/google", maxAge: 0 });
    return res;
  }
  if (user.mustChangePassword) {
    const res = NextResponse.redirect(new URL("/change-password", url.origin));
    res.cookies.set(GOOGLE_LINK_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/api/account-linking/google", maxAge: 0 });
    return res;
  }

  const cookieState = request.headers.get("cookie")?.match(/(?:^|;\s*)mt_google_link=([^;]+)/)?.[1];
  const stateParam = url.searchParams.get("state") ?? undefined;
  const cookieValue = cookieState ? decodeURIComponent(cookieState) : undefined;
  const state = verifyGoogleLinkState(cookieValue, user.id);
  const stateMatches = !!state && !!stateParam && stateParam === cookieValue;

  const clearCookie = (res: NextResponse) => {
    res.cookies.set(GOOGLE_LINK_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/api/account-linking/google", maxAge: 0 });
    return res;
  };

  if (!state || !stateMatches) {
    return clearCookie(redirectWith(url, returnTo, { google: "invalid_state" }));
  }

  const error = url.searchParams.get("error");
  if (error) {
    return clearCookie(redirectWith(url, state.returnTo, { google: error === "access_denied" ? "cancelled" : "failed" }));
  }

  const code = url.searchParams.get("code");
  if (!code) return clearCookie(redirectWith(url, state.returnTo, { google: "failed" }));

  const config = getGoogleOAuthConfig();
  if (!config) return clearCookie(redirectWith(url, state.returnTo, { google: "not_configured" }));

  const redirectUri = new URL("/api/account-linking/google/callback", url.origin).toString();
  const token = await exchangeGoogleCode({ code, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri });
  if (!token.ok) {
    console.error("[GoogleLinking] Token exchange failed", { error: token.error });
    return clearCookie(redirectWith(url, state.returnTo, { google: "failed" }));
  }

  const info = await fetchGoogleUserInfo(token.accessToken);
  if (!info?.sub) {
    return clearCookie(redirectWith(url, state.returnTo, { google: "failed" }));
  }

  try {
    const existing = await prisma.user.findUnique({ where: { googleSubject: info.sub }, select: { id: true } });
    if (existing && existing.id !== user.id) {
      return clearCookie(redirectWith(url, state.returnTo, { google: "already_linked" }));
    }
    if (user.googleSubject && user.googleSubject !== info.sub) {
      return clearCookie(redirectWith(url, state.returnTo, { google: "already_linked_self" }));
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        googleSubject: info.sub,
        googleEmail: info.email,
        googleLinkedAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[GoogleLinking] Link persistence failed", { name: (e as Error)?.name });
    return clearCookie(redirectWith(url, state.returnTo, { google: "failed" }));
  }

  return clearCookie(redirectWith(url, state.returnTo, { google: "linked" }));
}

export const GET = withApiErrorHandling(GETInternal, "/api/account-linking/google/callback");
