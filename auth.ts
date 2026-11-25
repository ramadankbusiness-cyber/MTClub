import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { CredentialsSignin } from "next-auth";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/schemas";
import { hashIdentifier, requestIp } from "@/lib/security";
import { authenticateCredentials, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } from "@/lib/login";
import { verifySessionTransition } from "@/lib/session-transition";
import { classifyLoginError, getSafeAuthEnvIssues, getSafeErrorLogFields } from "@/lib/auth-config";

class DisabledAccountSignin extends CredentialsSignin {
  code = "account-disabled";
}

class LockedAccountSignin extends CredentialsSignin {
  constructor(minutes: number) {
    super();
    this.code = `try-again-${minutes}`;
  }
}

class UnexpectedLoginSignin extends CredentialsSignin {
  constructor(errorId: string) {
    super();
    this.code = `login-error-${errorId}`;
  }
}

const isLocalSqliteDevelopment =
  process.env.NODE_ENV !== "production" &&
  (process.env.DATABASE_PROVIDER === "sqlite" || process.env.DATABASE_URL?.startsWith("file:") === true);
const localLoginFailures = new Map<string, Date[]>();

let authEnvWarningsLogged = false;
function logAuthEnvWarningsOnce() {
  if (authEnvWarningsLogged) return;
  authEnvWarningsLogged = true;
  const issues = getSafeAuthEnvIssues();
  if (issues.length === 0) return;
  console.warn("[auth] Environment configuration warnings", {
    issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
  });
}

function unexpectedLoginSignin(error: unknown, stage = "authorize"): UnexpectedLoginSignin {
  const errorId = randomUUID().slice(0, 8);
  const classification = classifyLoginError(error);
  const details = {
    errorId,
    stage,
    category: classification.category,
    ...(classification.code ? { errorCode: classification.code } : {}),
    ...(classification.hint ? { hint: classification.hint } : {}),
    ...getSafeErrorLogFields(error),
  };
  console.error("[auth] Unexpected login failure", details);
  return new UnexpectedLoginSignin(errorId);
}

function logLoginStep(step: string) {
  if (process.env.NODE_ENV === "development" && process.env.AUTH_DEBUG_LOGIN === "true") {
    console.info(`[auth][debug] ${step}`);
  }
}

export async function jwtCallback({ token, user, trigger, session }: { token: any; user?: any; trigger?: string; session?: any }) {
  try {
    if (user) {
      token.id = user.id;
      token.role = user.role;
      token.committeeId = user.committeeId;
      token.mustChangePassword = user.mustChangePassword;
      token.sessionVersion = user.sessionVersion;
      token.rememberMe = user.rememberMe ?? false;
      token.sessionJti = randomUUID();
      token.image = user.image ?? null;
    }
    if (token.id) {
      if (!token.sessionJti) token.sessionJti = randomUUID();
      const currentUser = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { role: true, committeeId: true, mustChangePassword: true, sessionVersion: true, isActive: true, photoUrl: true },
      });
      if (!currentUser?.isActive) return null;
      if (trigger === "update") {
        const transition = (session as { sessionTransition?: unknown } | undefined)?.sessionTransition;
        const authorizedTransition =
          token.sessionVersion !== currentUser.sessionVersion &&
          verifySessionTransition(transition, {
            userId: token.id as string,
            sessionJti: token.sessionJti as string,
            newSessionVersion: currentUser.sessionVersion,
          });
        if (token.sessionVersion !== currentUser.sessionVersion && !authorizedTransition) {
          return null;
        }
        token.role = currentUser.role;
        token.committeeId = currentUser.committeeId;
        token.mustChangePassword = currentUser.mustChangePassword;
        token.sessionVersion = currentUser.sessionVersion;
        token.image = currentUser.photoUrl;
        return token;
      }
      if (currentUser.sessionVersion !== token.sessionVersion) return null;
      token.role = currentUser.role;
      token.committeeId = currentUser.committeeId;
      token.mustChangePassword = currentUser.mustChangePassword;
      token.sessionVersion = currentUser.sessionVersion;
      token.image = currentUser.photoUrl;
    }
    return token;
  } catch (error) {
    console.error("[auth] JWT callback failed; returning null token.", {
      category: classifyLoginError(error).category,
      ...getSafeErrorLogFields(error),
    });
    return null;
  }
}

export async function authorizeCredentialsRequest(rawCredentials: unknown, request: Request) {
  logAuthEnvWarningsOnce();
  logLoginStep("credentials authorization started");
  const parsed = loginSchema.safeParse(rawCredentials);
  if (!parsed.success) {
    logLoginStep("credentials validation rejected the request");
    return null;
  }
  const { email, password, rememberMe } = parsed.data;
  try {
    const ipHash = hashIdentifier(requestIp(request));
    const result = await authenticateCredentials(
      { email, password, ipHash, rememberMe },
      {
        findUser: async (normalizedEmail) => {
          logLoginStep("querying account");
          const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
          logLoginStep(`account query completed; found=${!!user}`);
          if (!user) return null;
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            passwordHash: user.passwordHash,
            role: user.role,
            committeeId: user.committeeId,
            isActive: user.isActive,
            mustChangePassword: user.mustChangePassword,
            temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt,
            sessionVersion: user.sessionVersion,
            photoUrl: user.photoUrl,
          };
        },
        recentFailures: async (normalizedEmail, hashedIp, since) => {
          if (isLocalSqliteDevelopment) {
            const key = `${normalizedEmail}:${hashedIp}`;
            const failures = (localLoginFailures.get(key) ?? []).filter((date) => date >= since);
            localLoginFailures.set(key, failures);
            return failures;
          }
          logLoginStep("querying recent login attempts");
          const rows = await prisma.loginAttempt.findMany({
            where: { email: normalizedEmail, ipHash: hashedIp, succeeded: false, createdAt: { gte: since } },
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
          });
          logLoginStep(`login-attempt query completed; count=${rows.length}`);
          return rows.map((row) => row.createdAt);
        },
        comparePassword: async (candidate, hash) => {
          logLoginStep("checking password hash");
          const matches = await bcrypt.compare(candidate, hash);
          logLoginStep("password hash check completed");
          return matches;
        },
        recordAttempt: async (normalizedEmail, hashedIp, succeeded) => {
          if (isLocalSqliteDevelopment) {
            if (!succeeded) {
              const key = `${normalizedEmail}:${hashedIp}`;
              const since = new Date(Date.now() - LOGIN_WINDOW_MS);
              const failures = (localLoginFailures.get(key) ?? []).filter((date) => date >= since);
              failures.push(new Date());
              localLoginFailures.set(key, failures.slice(-LOGIN_MAX_ATTEMPTS));
            }
            logLoginStep("local SQLite login attempt recorded in memory");
            return;
          }
          logLoginStep("recording login attempt");
          await prisma.loginAttempt.create({ data: { email: normalizedEmail, ipHash: hashedIp, succeeded } });
          logLoginStep("login attempt recorded");
        },
        dummyPasswordHash: "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6O4zjvMfN48QYQKae4S/Qyt8uBz8K",
      },
    );
    logLoginStep("credential authentication completed");
    if ("failure" in result) {
      if (result.failure === "disabled") throw new DisabledAccountSignin();
      if (result.failure === "locked") throw new LockedAccountSignin(result.retryAfterMinutes ?? Math.ceil(LOGIN_WINDOW_MS / 60_000));
      return null;
    }
    return {
      id: result.account.id,
      name: result.account.name,
      email: result.account.email,
      image: result.account.photoUrl,
      role: result.account.role,
      committeeId: result.account.committeeId,
      mustChangePassword: result.account.mustChangePassword,
      sessionVersion: result.account.sessionVersion,
      rememberMe: result.rememberMe,
    };
  } catch (error) {
    if (error instanceof DisabledAccountSignin || error instanceof LockedAccountSignin || error instanceof UnexpectedLoginSignin) {
      throw error;
    }
    if (error instanceof CredentialsSignin) {
      // Preserve explicit credential-signin subclasses/codes if any are added later.
      throw error;
    }
    throw unexpectedLoginSignin(error, "credentials_authorize");
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  jwt: {
    encode: async (params) => encode({
      ...params,
      maxAge: params.token?.rememberMe ? 30 * 24 * 60 * 60 : 8 * 60 * 60,
    }),
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        rememberMe: { label: "Remember me", type: "text" },
      },
      authorize: authorizeCredentialsRequest,
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        if (token.role === "ADMIN" || token.role === "LEADER" || token.role === "MEMBER") {
          session.user.role = token.role;
        }
        session.user.committeeId = token.committeeId as string | null;
        session.user.mustChangePassword = token.mustChangePassword as boolean;
        session.user.sessionVersion = token.sessionVersion as number;
        session.user.image = (token.image as string | null | undefined) ?? null;
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      try {
        if ("token" in message && message.token?.id) {
          if (isLocalSqliteDevelopment) {
            logLoginStep("skipping persistent session revocation for local SQLite development");
            return;
          }
          await prisma.user.updateMany({
            where: { id: message.token.id as string },
            data: { sessionVersion: { increment: 1 } },
          });
        }
      } catch (error) {
        console.error("[auth] signOut event failed.", {
          category: classifyLoginError(error).category,
          ...getSafeErrorLogFields(error),
        });
      }
    },
  },
});
