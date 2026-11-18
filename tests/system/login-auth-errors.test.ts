import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn() },
  loginAttempt: { findMany: vi.fn(), create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: {}, signIn: {}, signOut: {} }),
  CredentialsSignin: class CredentialsSignin extends Error {
    code?: string;
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (cfg: unknown) => cfg }));
vi.mock("next-auth/jwt", () => ({ encode: vi.fn(async () => "token") }));

import bcrypt from "bcryptjs";
import { classifyLoginError, getAuthSecretState, getSafeDatabaseEnvIssues, getSafeErrorLogFields, redactSensitiveText } from "@/lib/auth-config";

const TEST_SECRET = "test-secret-test-secret-test-secret-123456";
const TEST_EMAIL = "member@mtclub.test";

const originalEnv = { ...process.env };

function makeRequest(ip = "203.0.113.10") {
  return new Request("http://localhost/api/auth/callback/credentials", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "MT Member",
    email: TEST_EMAIL,
    passwordHash: "hashed-password",
    role: "MEMBER",
    committeeId: "committee-1",
    isActive: true,
    mustChangePassword: false,
    temporaryPasswordExpiresAt: null,
    sessionVersion: 3,
    ...overrides,
  };
}

async function loadAuthorize() {
  vi.resetModules();
  const mod = await import("@/auth");
  return mod.authorizeCredentialsRequest as (rawCredentials: unknown, request: Request) => Promise<any>;
}

describe("login authorize flow hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env = { ...originalEnv };
    // Force production-like DB path (not local SQLite in-memory login attempts)
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_PROVIDER;
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AUTH_SECRET = TEST_SECRET;
    prismaMock.user.findUnique.mockReset();
    prismaMock.loginAttempt.findMany.mockReset();
    prismaMock.loginAttempt.create.mockReset();
    prismaMock.loginAttempt.findMany.mockResolvedValue([]);
    prismaMock.loginAttempt.create.mockResolvedValue({ id: "attempt-1" });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("authenticates with correct password and records a successful login attempt", async () => {
    const compareSpy = vi.spyOn(bcrypt, "compare").mockResolvedValue(true as never);
    prismaMock.user.findUnique.mockResolvedValue(baseUser());
    const authorizeCredentialsRequest = await loadAuthorize();

    const result = await authorizeCredentialsRequest(
      { email: TEST_EMAIL, password: "CorrectPass123!", rememberMe: true },
      makeRequest(),
    );

    expect(compareSpy).toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "user-1",
      email: TEST_EMAIL,
      role: "MEMBER",
      mustChangePassword: false,
      sessionVersion: 3,
      rememberMe: true,
    });
    expect(prismaMock.loginAttempt.findMany).toHaveBeenCalled();
    expect(prismaMock.loginAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: TEST_EMAIL, succeeded: true, ipHash: expect.any(String) }),
    });
  });

  it("returns null for wrong password and records a failed login attempt", async () => {
    vi.spyOn(bcrypt, "compare").mockResolvedValue(false as never);
    prismaMock.user.findUnique.mockResolvedValue(baseUser());
    const authorizeCredentialsRequest = await loadAuthorize();

    const result = await authorizeCredentialsRequest(
      { email: TEST_EMAIL, password: "WrongPass123!", rememberMe: false },
      makeRequest(),
    );

    expect(result).toBeNull();
    expect(prismaMock.loginAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: TEST_EMAIL, succeeded: false, ipHash: expect.any(String) }),
    });
  });

  it("throws disabled account signin after correct password for inactive account", async () => {
    vi.spyOn(bcrypt, "compare").mockResolvedValue(true as never);
    prismaMock.user.findUnique.mockResolvedValue(baseUser({ isActive: false }));
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "CorrectPass123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: "account-disabled" });
  });

  it("throws locked account signin when recent failed attempts reach the limit", async () => {
    prismaMock.user.findUnique.mockResolvedValue(baseUser());
    const recent = Array.from({ length: 5 }, (_, i) => ({ createdAt: new Date(Date.now() - i * 1000) }));
    prismaMock.loginAttempt.findMany.mockResolvedValue(recent);
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "AnyPassword123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^try-again-\d+$/) });
  });

  it("allows first-login temporary password state to authenticate (mustChangePassword true)", async () => {
    vi.spyOn(bcrypt, "compare").mockResolvedValue(true as never);
    prismaMock.user.findUnique.mockResolvedValue(
      baseUser({ mustChangePassword: true, temporaryPasswordExpiresAt: null }),
    );
    const authorizeCredentialsRequest = await loadAuthorize();

    const result = await authorizeCredentialsRequest(
      { email: TEST_EMAIL, password: "mtc123", rememberMe: false },
      makeRequest(),
    );

    expect(result).toMatchObject({ id: "user-1", mustChangePassword: true });
  });

  it("wraps database connection failures as unexpected login errors with an Error ID and safe logs", async () => {
    const dbError = Object.assign(new Error("Can't reach database server"), { code: "P1001", name: "PrismaClientInitializationError" });
    prismaMock.user.findUnique.mockRejectedValue(dbError);
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "CorrectPass123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^login-error-[a-f0-9]{8}$/) });

    expect(console.error).toHaveBeenCalledWith(
      "[auth] Unexpected login failure",
      expect.objectContaining({ errorId: expect.stringMatching(/^[a-f0-9]{8}$/), category: "database_connection", errorCode: "P1001" }),
    );
  });

  it("wraps missing AUTH_SECRET as an unexpected login error with Error ID (hashIdentifier failure handled)", async () => {
    delete process.env.AUTH_SECRET;
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "CorrectPass123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^login-error-[a-f0-9]{8}$/) });

    expect(console.error).toHaveBeenCalledWith(
      "[auth] Unexpected login failure",
      expect.objectContaining({ category: "auth_secret_invalid" }),
    );
  });

  it("wraps short AUTH_SECRET as an unexpected login error with Error ID", async () => {
    process.env.AUTH_SECRET = "too-short-secret";
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "CorrectPass123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^login-error-[a-f0-9]{8}$/) });

    expect(console.error).toHaveBeenCalledWith(
      "[auth] Unexpected login failure",
      expect.objectContaining({ category: "auth_secret_invalid" }),
    );
  });

  it("classifies transaction pooler prepared-statement errors and does not leak secrets in logs", async () => {
    process.env.DATABASE_URL = "postgresql://user:supersecret@db.pooler.supabase.com:6543/postgres";
    const poolerError = Object.assign(new Error('prepared statement "s0" already exists'), {
      code: "42P05",
      name: "PrismaClientKnownRequestError",
    });
    prismaMock.user.findUnique.mockRejectedValue(poolerError);
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "CorrectPass123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^login-error-[a-f0-9]{8}$/) });

    const logged = (console.error as any).mock.calls.find((call: unknown[]) => call[0] === "[auth] Unexpected login failure")?.[1];
    expect(logged).toMatchObject({ category: "database_pooler_prepared_statement", hint: expect.stringContaining("pgbouncer=true") });
    const serialized = JSON.stringify((console.error as any).mock.calls);
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain(TEST_SECRET);
  });

  it("classifies PostgreSQL 42P05 conflicts from non-Prisma drivers and redacts sensitive error details", async () => {
    const pgDriverError = Object.assign(
      new Error('prepared statement "s2" already exists while connecting postgresql://dbuser:dbpass@host/db AUTH_SECRET=topsecret'),
      {
        code: "42P05",
        name: "DatabaseError",
        meta: {
          modelName: "User",
          target: ["email", "postgresql://dbuser:dbpass@host/db"],
          password: "leak",
          unexpectedObject: { token: "leak" },
        },
      },
    );
    prismaMock.user.findUnique.mockRejectedValue(pgDriverError);
    const authorizeCredentialsRequest = await loadAuthorize();

    await expect(
      authorizeCredentialsRequest({ email: TEST_EMAIL, password: "CorrectPass123!" }, makeRequest()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^login-error-[a-f0-9]{8}$/) });

    const logged = (console.error as any).mock.calls.find((call: unknown[]) => call[0] === "[auth] Unexpected login failure")?.[1];
    expect(logged).toMatchObject({ category: "database_pooler_prepared_statement", errorCode: "42P05" });
    expect(logged?.meta).toEqual({ modelName: "User", target: ["email", "[REDACTED_CONNECTION_STRING]"] });
    const serialized = JSON.stringify((console.error as any).mock.calls);
    expect(serialized).not.toContain("dbpass");
    expect(serialized).not.toContain("topsecret");
    expect(serialized).not.toContain("leak");
    expect(serialized).not.toContain("postgresql://dbuser:dbpass@host/db");
  });
});

describe("auth env validation helpers", () => {
  it("detects missing or too-short AUTH_SECRET without exposing values", () => {
    expect(getAuthSecretState(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(getAuthSecretState("short")).toEqual({ ok: false, reason: "too_short" });
    expect(getAuthSecretState(TEST_SECRET)).toEqual({ ok: true });
  });

  it("detects transaction pooler DATABASE_URL missing pgbouncer=true", () => {
    const issues = getSafeDatabaseEnvIssues({
      DATABASE_URL: "postgresql://user:pass@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
    } as NodeJS.ProcessEnv);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PGBOUNCER_PARAM_MISSING" })]));
    expect(JSON.stringify(issues)).not.toContain("pass");
  });

  it("accepts transaction pooler DATABASE_URL with pgbouncer=true", () => {
    const issues = getSafeDatabaseEnvIssues({
      DATABASE_URL: "postgresql://user:pass@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true",
      DIRECT_URL: "postgresql://user:pass@db.supabase.co:5432/postgres",
    } as NodeJS.ProcessEnv);
    expect(issues.some((i) => i.code === "PGBOUNCER_PARAM_MISSING")).toBe(false);
  });

  it("classifies auth secret configuration errors", () => {
    expect(classifyLoginError(new Error("AUTH_SECRET must contain at least 32 characters")).category).toBe("auth_secret_invalid");
  });

  it("classifies PostgreSQL 42P05 prepared statement conflicts from non-Prisma drivers", () => {
    const pgDriverError = Object.assign(new Error('prepared statement "s1" already exists'), {
      code: "42P05",
      name: "DatabaseError",
    });
    expect(classifyLoginError(pgDriverError)).toMatchObject({
      category: "database_pooler_prepared_statement",
      code: "42P05",
      hint: expect.stringContaining("pgbouncer=true"),
    });
  });

  it("classifies Prisma prepared statement errors", () => {
    const prismaError = Object.assign(new Error('prepared statement "s0" already exists'), {
      code: "P2034",
      name: "PrismaClientKnownRequestError",
    });
    expect(classifyLoginError(prismaError)).toMatchObject({
      category: "database_pooler_prepared_statement",
      code: "P2034",
      hint: expect.stringContaining("pgbouncer=true"),
    });
  });

  it("continues logging valid Prisma and PostgreSQL error codes", () => {
    const prismaFields = getSafeErrorLogFields(
      Object.assign(new Error("Can't reach database server"), {
        code: "P1001",
        name: "PrismaClientInitializationError",
        clientVersion: "6.19.3",
      }),
    );
    expect(prismaFields).toMatchObject({
      errorCode: "P1001",
      errorName: "PrismaClientInitializationError",
      prismaClientVersion: "6.19.3",
    });
    expect(classifyLoginError({ code: "P2021", name: "PrismaClientKnownRequestError", message: "table missing" })).toMatchObject({
      category: "database_schema_mismatch",
      code: "P2021",
    });

    const pgFields = getSafeErrorLogFields(
      Object.assign(new Error('prepared statement "s1" already exists'), {
        code: "42P05",
        name: "DatabaseError",
      }),
    );
    expect(pgFields).toMatchObject({ errorCode: "42P05", errorName: "DatabaseError" });
    expect(classifyLoginError({ code: "42P05", name: "DatabaseError", message: 'prepared statement "s1" already exists' })).toMatchObject({
      category: "database_pooler_prepared_statement",
      code: "42P05",
      hint: expect.stringContaining("pgbouncer=true"),
    });
  });

  it("ignores unsafe or too-long error codes in classification and logs", () => {
    const unsafeCode = "P1001; DROP TABLE users";
    const longCode = "P".repeat(40);

    // Unsafe code is not logged/returned and must not drive code-specific classification (e.g. P1001 connection bucket).
    const unsafeCodeError = Object.assign(new Error("Can't reach database server"), {
      code: unsafeCode,
      name: "PrismaClientInitializationError",
    });
    const unsafeFields = getSafeErrorLogFields(unsafeCodeError);
    expect(unsafeFields.errorCode).toBeUndefined();
    expect(classifyLoginError(unsafeCodeError)).toMatchObject({ category: "database_error" });
    expect(classifyLoginError(unsafeCodeError)).not.toMatchObject({ category: "database_connection" });
    expect(classifyLoginError(unsafeCodeError).code).toBeUndefined();

    // When classification would depend only on the invalid code, fall back safely without using/logging the code.
    const longCodeOnly = { message: "db error", name: "DatabaseError", code: longCode };
    const longCodeFields = getSafeErrorLogFields(longCodeOnly);
    expect(longCodeFields.errorCode).toBeUndefined();
    expect(classifyLoginError(longCodeOnly)).toMatchObject({ category: "unexpected_error" });
    expect(classifyLoginError(longCodeOnly).code).toBeUndefined();

    const injectedPgCode = { message: "some db error", name: "DatabaseError", code: "42P05 OR 1=1" };
    expect(getSafeErrorLogFields(injectedPgCode).errorCode).toBeUndefined();
    expect(classifyLoginError(injectedPgCode)).toMatchObject({ category: "unexpected_error" });
  });

  it("ignores unexpected or too-long error.name and clientVersion values in logs", () => {
    const fields = getSafeErrorLogFields(
      Object.assign(new Error("boom"), {
        code: "P1001",
        name: "PrismaClientKnownRequestError\nDROP TABLE users",
        clientVersion: "6.19.3; malicious-payload-that-should-not-be-logged-because-it-is-way-too-long-and-unsafe",
      }),
    );
    expect(fields.errorCode).toBe("P1001");
    expect(fields.errorName).toBeUndefined();
    expect(fields.prismaClientVersion).toBeUndefined();

    const longNameFields = getSafeErrorLogFields({
      message: "x",
      code: "42P05",
      name: `E${"r".repeat(120)}`,
      clientVersion: "1".repeat(80),
    });
    expect(longNameFields.errorName).toBeUndefined();
    expect(longNameFields.prismaClientVersion).toBeUndefined();
    expect(longNameFields.errorCode).toBe("42P05");
  });

  it("redacts connection strings and sensitive secret values in error messages without removing non-sensitive diagnostics", () => {
    const redactedUrl = redactSensitiveText("connect failed postgresql://user:supersecret@db.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(redactedUrl).toContain("connect failed");
    expect(redactedUrl).toContain("[REDACTED_CONNECTION_STRING]");
    expect(redactedUrl).not.toContain("supersecret");
    expect(redactedUrl).not.toContain("postgresql://user:supersecret");

    const bearerJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const redactedSecrets = redactSensitiveText(
      `AUTH_SECRET=my-real-secret DATABASE_URL=postgresql://u:p@host/db token=abc123 Bearer ${bearerJwt} bearer opaque_token-abc.DEF_123~+/=`,
    );
    expect(redactedSecrets).toContain("AUTH_SECRET=");
    expect(redactedSecrets).toContain("DATABASE_URL=");
    expect(redactedSecrets).toContain("token=");
    expect(redactedSecrets.match(/Bearer \[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
    expect(redactedSecrets).not.toContain("my-real-secret");
    expect(redactedSecrets).not.toContain("abc123");
    expect(redactedSecrets).not.toContain("postgresql://u:p@host/db");
    expect(redactedSecrets).not.toContain(bearerJwt);
    expect(redactedSecrets).not.toContain("opaque_token-abc");
    expect(redactedSecrets).not.toContain("DEF_123~+/=");

    // Diagnostic text must remain
    expect(redactSensitiveText("AUTH_SECRET must contain at least 32 characters")).toBe(
      "AUTH_SECRET must contain at least 32 characters",
    );
    expect(redactSensitiveText("Database schema may be out of sync with Prisma schema/migrations.")).toBe(
      "Database schema may be out of sync with Prisma schema/migrations.",
    );
  });

  it("redacts JSON secret values (string, numeric, boolean) while preserving structure as much as possible", () => {
    const input =
      'details {"password":"p@ss","token":12345,"apiKey":true,"nestedSafe":"ok","secret":"x"} and AUTH_SECRET must contain at least 32 characters';
    const redacted = redactSensitiveText(input);
    expect(redacted).toContain('"password":"[REDACTED]"');
    expect(redacted).toContain('"token":"[REDACTED]"');
    expect(redacted).toContain('"apiKey":"[REDACTED]"');
    expect(redacted).toContain('"nestedSafe":"ok"');
    expect(redacted).toContain('"secret":"[REDACTED]"');
    expect(redacted).toContain("AUTH_SECRET must contain at least 32 characters");
    expect(redacted).not.toContain("p@ss");
    expect(redacted).not.toContain("12345");
    expect(redacted).not.toContain(':true');
  });

  it("sanitizes logged meta: allows safe values, redacts sensitive strings, and drops unexpected/object values", () => {
    const fields = getSafeErrorLogFields(
      Object.assign(new Error("query failed with AUTH_SECRET=topsecret and postgresql://u:pw@host/db"), {
        code: "42P05",
        name: "DatabaseError",
        meta: {
          modelName: "User",
          table: "User",
          target: ["email", "postgresql://u:pw@host/db"],
          column: "password_hash",
          constraint: "User_email_key",
          unexpectedObject: { password: "leak" },
          password: "leak",
          nested: [{ secret: "x" }],
        },
      }),
    );

    expect(fields.errorCode).toBe("42P05");
    expect(String(fields.errorMessage)).not.toContain("topsecret");
    expect(String(fields.errorMessage)).not.toContain("postgresql://u:pw@host/db");
    expect(String(fields.errorMessage)).toContain("[REDACTED");

    expect(fields.meta).toEqual({
      modelName: "User",
      table: "User",
      target: ["email", "[REDACTED_CONNECTION_STRING]"],
      column: "password_hash",
      constraint: "User_email_key",
    });
    expect(JSON.stringify(fields)).not.toContain("leak");
    expect(JSON.stringify(fields)).not.toContain("topsecret");
    expect(JSON.stringify(fields)).not.toContain("postgresql://u:pw@host/db");
  });

  it("caps meta string length to 200, error message to 500, and meta arrays to first 20 safe sanitized elements", () => {
    const longString = "a".repeat(250);
    const longMessage = `prefix AUTH_SECRET=super-secret-value ${"x".repeat(600)} suffix`;
    const target = Array.from({ length: 30 }, (_, i) => (i === 5 ? "postgresql://u:pw@host/db" : `field-${i + 1}`));
    const fields = getSafeErrorLogFields(
      Object.assign(new Error(longMessage), {
        code: "P2002",
        name: "PrismaClientKnownRequestError",
        meta: {
          modelName: "User",
          table: longString,
          target,
        },
      }),
    );

    expect(String(fields.errorMessage).length).toBeLessThanOrEqual(500);
    expect(String(fields.errorMessage)).toContain("prefix");
    expect(String(fields.errorMessage)).toContain("AUTH_SECRET=");
    expect(String(fields.errorMessage)).not.toContain("super-secret-value");

    expect((fields.meta as any).table).toHaveLength(200);
    expect((fields.meta as any).target).toHaveLength(20);
    expect((fields.meta as any).target[0]).toBe("field-1");
    expect((fields.meta as any).target[5]).toBe("[REDACTED_CONNECTION_STRING]");
    expect((fields.meta as any).target[19]).toBe("field-20");
    expect(JSON.stringify(fields)).not.toContain("field-21");
  });
});
