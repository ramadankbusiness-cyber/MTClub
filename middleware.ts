import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { removeLocalePrefix, safeReturnPath } from "@/lib/login";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createMiddleware(routing);
const locales = new Set<string>(routing.locales);

export async function middleware(request: NextRequest) {
  const firstSegment = request.nextUrl.pathname.split("/")[1];
  if (!locales.has(firstSegment)) return handleI18nRouting(request);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-mt-locale", firstSegment);
  const localizedRequest = new NextRequest(request.url, {
    headers: requestHeaders,
  });
  const intlResponse = handleI18nRouting(localizedRequest);
  if (intlResponse.status >= 300 && intlResponse.status < 400) return intlResponse;

  const pathname = request.nextUrl.pathname.replace(/^\/(en|ar)(?=\/|$)/, "") || "/";
  const locale = firstSegment;
  if (!["/dashboard", "/admin", "/attendance", "/notifications", "/profile", "/excuses", "/change-password"].some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return intlResponse;
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.nextUrl.protocol === "https:",
  });
  if (!token?.id) {
    const callbackUrl = safeReturnPath(removeLocalePrefix(`${request.nextUrl.pathname}${request.nextUrl.search}`));
    const loginUrl = new URL(`/${locale}/login`, request.url);
    if (callbackUrl) loginUrl.searchParams.set("callbackUrl", callbackUrl);
    loginUrl.searchParams.set("message", "login-required");
    return NextResponse.redirect(loginUrl);
  }
  if (token.mustChangePassword && pathname !== "/change-password") {
    return NextResponse.redirect(new URL(`/${locale}/change-password`, request.url));
  }
  return intlResponse;
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
