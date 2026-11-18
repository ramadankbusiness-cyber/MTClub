const CONNECTION_STRING_PATTERN = /(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql|sqlserver):\/\/[^\s"'<>),\]]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /(\b(?:AUTH_SECRET|DATABASE_URL|DIRECT_URL|PASSWORD|PASSWD|PWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH_URL|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_SITE_URL)\b\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,;}\]\r\n]+))/gi;
const SECRET_JSON_PATTERN = /("?(?:password|passwd|pwd|secret|token|apiKey|accessKey|privateKey|clientSecret|authSecret|databaseUrl|directUrl)"?\s*:\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false)\b)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[^\s\r\n"'<>,]+/gi;

const SAFE_META_KEYS = new Set(["modelName", "table", "target", "column", "constraint"]);
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z0-9_$.-]{1,80}$/;
const SAFE_CLIENT_VERSION_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/;

export type SafeEnvIssue = {
  code: string;
  message: string;
};

function safeParseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function getAuthSecretState(secret?: string): { ok: true } | { ok: false; reason: "missing" | "too_short" } {
  const value = arguments.length === 0 ? process.env.AUTH_SECRET : secret;
  if (!value) return { ok: false, reason: "missing" };
  if (value.length < 32) return { ok: false, reason: "too_short" };
  return { ok: true };
}

export function isSupabaseTransactionPoolerUrl(databaseUrl: string | undefined): boolean {
  const parsed = safeParseUrl(databaseUrl);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return host.includes(".pooler.supabase.com") || parsed.port === "6543";
}

export function hasPgBouncerParam(databaseUrl: string | undefined): boolean {
  const parsed = safeParseUrl(databaseUrl);
  if (!parsed) return false;
  const value = parsed.searchParams.get("pgbouncer");
  return value?.toLowerCase() === "true";
}

export function getSafeDatabaseEnvIssues(env = process.env): SafeEnvIssue[] {
  const issues: SafeEnvIssue[] = [];
  if (!env.DATABASE_URL) {
    issues.push({ code: "DATABASE_URL_MISSING", message: "DATABASE_URL is not configured." });
  } else {
    const parsed = safeParseUrl(env.DATABASE_URL);
    if (!parsed) {
      issues.push({ code: "DATABASE_URL_INVALID", message: "DATABASE_URL is not a valid URL." });
    } else if (isSupabaseTransactionPoolerUrl(env.DATABASE_URL) && !hasPgBouncerParam(env.DATABASE_URL)) {
      issues.push({
        code: "PGBOUNCER_PARAM_MISSING",
        message: "DATABASE_URL appears to use a transaction pooler but is missing pgbouncer=true.",
      });
    }
  }

  if (env.DIRECT_URL) {
    const direct = safeParseUrl(env.DIRECT_URL);
    if (!direct) {
      issues.push({ code: "DIRECT_URL_INVALID", message: "DIRECT_URL is not a valid URL." });
    }
  }

  return issues;
}

export function getSafeAuthEnvIssues(env = process.env): SafeEnvIssue[] {
  const issues: SafeEnvIssue[] = [];
  const authSecret = getAuthSecretState(env.AUTH_SECRET);
  if (!authSecret.ok) {
    issues.push({
      code: authSecret.reason === "missing" ? "AUTH_SECRET_MISSING" : "AUTH_SECRET_TOO_SHORT",
      message: authSecret.reason === "missing" ? "AUTH_SECRET is not configured." : "AUTH_SECRET must contain at least 32 characters.",
    });
  }
  issues.push(...getSafeDatabaseEnvIssues(env));
  return issues;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(CONNECTION_STRING_PATTERN, "[REDACTED_CONNECTION_STRING]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(SECRET_JSON_PATTERN, (_match, prefix: string, dq?: string, sq?: string, num?: string, bool?: string) => {
      if (dq !== undefined) return `${prefix}"[REDACTED]"`;
      if (sq !== undefined) return `${prefix}'[REDACTED]'`;
      if (num !== undefined || bool !== undefined) return `${prefix}"[REDACTED]"`;
      return `${prefix}"[REDACTED]"`;
    })
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string, dq?: string, sq?: string, plain?: string) => {
      if (dq !== undefined) return `${prefix}"[REDACTED]"`;
      if (sq !== undefined) return `${prefix}'[REDACTED]'`;
      if (plain !== undefined) return `${prefix}[REDACTED]`;
      return `${prefix}[REDACTED]`;
    });
}

function sanitizeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ERROR_CODE_PATTERN.test(value) ? value : undefined;
}

function sanitizeErrorName(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ERROR_NAME_PATTERN.test(value) ? value : undefined;
}

function sanitizeClientVersion(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_CLIENT_VERSION_PATTERN.test(value) ? value : undefined;
}

function isPreparedStatementConflict(code: string | undefined, messageLower: string): boolean {
  if (code === "42P05") return true;
  return messageLower.includes("prepared statement") && messageLower.includes("already exists");
}

export function classifyLoginError(error: unknown): { category: string; code?: string; hint?: string } {
  if (!error || typeof error !== "object") return { category: "unknown_error" };
  const err = error as { name?: unknown; code?: unknown; message?: unknown; clientVersion?: unknown };
  const name = sanitizeErrorName(err.name) ?? "Error";
  const code = sanitizeErrorCode(err.code);
  const message = typeof err.message === "string" ? err.message : "";
  const lower = message.toLowerCase();

  if (lower.includes("auth_secret must contain at least 32 characters")) {
    return { category: "auth_secret_invalid", ...(code ? { code } : {}), hint: "Check AUTH_SECRET presence and length (>= 32 characters)." };
  }
  // Detect PostgreSQL 42P05 / prepared statement conflicts early (including non-Prisma drivers)
  if (isPreparedStatementConflict(code, lower)) {
    return {
      category: "database_pooler_prepared_statement",
      ...(code ? { code } : {}),
      hint: "Possible PgBouncer transaction pooler misconfiguration: ensure DATABASE_URL includes pgbouncer=true.",
    };
  }
  if (code === "P1001" || code === "P1002" || code === "P1003" || code === "P1017") {
    return { category: "database_connection", code, hint: "Check DATABASE_URL/connectivity and database availability." };
  }
  if (code === "P2021" || code === "P2022") {
    return { category: "database_schema_mismatch", code, hint: "Database schema may be out of sync with Prisma schema/migrations." };
  }
  if (name.startsWith("Prisma") || (code?.startsWith("P") ?? false)) {
    return { category: "database_error", ...(code ? { code } : {}) };
  }
  if (lower.includes("bcrypt")) {
    return { category: "password_hash_error", ...(code ? { code } : {}) };
  }
  return { category: "unexpected_error", ...(code ? { code } : {}) };
}

const MAX_META_STRING_LENGTH = 200;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_META_ARRAY_ITEMS = 20;

function sanitizeMetaValue(value: unknown): string | number | boolean | Array<string | number | boolean> | undefined {
  if (typeof value === "string") return redactSensitiveText(value).slice(0, MAX_META_STRING_LENGTH);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const sanitized = value
      .map((item) => {
        if (typeof item === "string") return redactSensitiveText(item).slice(0, MAX_META_STRING_LENGTH);
        if (typeof item === "number") return Number.isFinite(item) ? item : undefined;
        if (typeof item === "boolean") return item;
        return undefined;
      })
      .filter((item): item is string | number | boolean => item !== undefined)
      .slice(0, MAX_META_ARRAY_ITEMS);
    return sanitized.length > 0 ? sanitized : undefined;
  }
  return undefined;
}

export function getSafeErrorLogFields(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { errorType: typeof error };
  }
  const err = error as { name?: unknown; code?: unknown; message?: unknown; clientVersion?: unknown };
  const fields: Record<string, unknown> = {};
  const safeName = sanitizeErrorName(err.name);
  if (safeName) fields.errorName = safeName;
  const safeCode = sanitizeErrorCode(err.code);
  if (safeCode) fields.errorCode = safeCode;
  if (typeof err.message === "string") fields.errorMessage = redactSensitiveText(err.message).slice(0, MAX_ERROR_MESSAGE_LENGTH);
  const safeClientVersion = sanitizeClientVersion(err.clientVersion);
  if (safeClientVersion) fields.prismaClientVersion = safeClientVersion;
  const meta = (err as { meta?: unknown }).meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    // meta can contain model/table/constraint info but must never leak secrets or unexpected values
    const safeMeta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
      if (!SAFE_META_KEYS.has(key)) continue;
      const sanitized = sanitizeMetaValue(value);
      if (sanitized !== undefined) safeMeta[key] = sanitized;
    }
    if (Object.keys(safeMeta).length > 0) fields.meta = safeMeta;
  }
  return fields;
}
