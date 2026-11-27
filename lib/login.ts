import type { Role } from "@/lib/db-enums";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 5;

export type LoginAccount = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  committeeId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt: Date | null;
  sessionVersion: number;
  photoUrl: string | null;
  googleLinked: boolean;
  telegramLinked: boolean;
};

export type LoginFailure = "invalid" | "disabled" | "locked";

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value, "https://mtclub.invalid");
    if (url.origin !== "https://mtclub.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function removeLocalePrefix(value: string): string {
  let path = value;
  while (/^\/(?:en|ar)(?=\/|$)/.test(path)) {
    path = path.replace(/^\/(?:en|ar)(?=\/|$)/, "");
  }
  return path || "/";
}

export function getPostLoginPath(
  mustChangePassword: boolean,
  callbackUrl: string | null | undefined,
): string {
  if (mustChangePassword) return "/change-password";
  const safePath = safeReturnPath(callbackUrl);
  return safePath ? removeLocalePrefix(safePath) : "/dashboard";
}

export function isSignInSuccess(result: { ok?: boolean; error?: string } | null | undefined): boolean {
  return result?.ok === true && !result.error;
}

export function isCredentialSignInFailure(
  result: { error?: string; code?: string } | null | undefined,
): boolean {
  return (result?.error === "CredentialsSignin"
    && !getLoginErrorReference(result.code))
    || result?.code === "account-disabled"
    || result?.code?.startsWith("try-again-") === true;
}

export function getLoginErrorReference(code: string | undefined): string | null {
  return code?.match(/^login-error-([a-f0-9]{8})$/)?.[1] ?? null;
}

export function lockoutMinutes(attempts: Date[], now = Date.now()): number | null {
  const recentAttempts = attempts
    .filter((attempt) => now - attempt.getTime() < LOGIN_WINDOW_MS)
    .sort((left, right) => left.getTime() - right.getTime());
  if (recentAttempts.length < LOGIN_MAX_ATTEMPTS) return null;
  const retryAt = recentAttempts[0].getTime() + LOGIN_WINDOW_MS;
  return Math.max(1, Math.ceil((retryAt - now) / 60_000));
}

export async function authenticateCredentials(
  input: { email: string; password: string; ipHash: string; rememberMe: boolean },
  dependencies: {
    findUser(email: string): Promise<LoginAccount | null>;
    recentFailures(email: string, ipHash: string, since: Date): Promise<Date[]>;
    comparePassword(password: string, hash: string): Promise<boolean>;
    recordAttempt(email: string, ipHash: string, succeeded: boolean): Promise<void>;
    dummyPasswordHash: string;
    now?: () => number;
  },
): Promise<{ account: LoginAccount; rememberMe: boolean } | { failure: LoginFailure; retryAfterMinutes?: number }> {
  const now = dependencies.now?.() ?? Date.now();
  const getFailures = () => dependencies.recentFailures(input.email, input.ipHash, new Date(now - LOGIN_WINDOW_MS));
  const existingFailures = await getFailures();
  const existingLock = lockoutMinutes(existingFailures, now);
  if (existingLock) return { failure: "locked", retryAfterMinutes: existingLock };

  const account = await dependencies.findUser(input.email);
  const passwordMatches = await dependencies.comparePassword(
    input.password,
    account?.passwordHash ?? dependencies.dummyPasswordHash,
  );
  const temporaryPasswordExpired = !!(
    account?.mustChangePassword &&
    account.temporaryPasswordExpiresAt &&
    account.temporaryPasswordExpiresAt.getTime() <= now
  );
  const success = !!account && account.isActive && passwordMatches && !temporaryPasswordExpired;
  await dependencies.recordAttempt(input.email, input.ipHash, success);

  if (account && !account.isActive && passwordMatches) return { failure: "disabled" };
  if (success && account) return { account, rememberMe: input.rememberMe };

  const failures = await getFailures();
  const retryAfterMinutes = lockoutMinutes(failures, now);
  return retryAfterMinutes
    ? { failure: "locked", retryAfterMinutes }
    : { failure: "invalid" };
}
