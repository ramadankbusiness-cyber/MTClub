const PRIVATE_BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,62}$/i;

export class PrivateStorageConfigError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
    this.name = "PrivateStorageConfigError";
  }
}

export function resolvePrivateBucket(options: {
  configuredValue: string | undefined;
  fallback: string;
  kind: "form" | "certificate";
}): string {
  const raw = options.configuredValue;
  const hasConfiguredValue = typeof raw === "string";
  const configured = hasConfiguredValue ? raw.trim() : "";
  if (hasConfiguredValue && configured.length === 0) {
    throw new PrivateStorageConfigError(
      `Private ${options.kind} storage bucket configuration is invalid.`,
      503,
    );
  }
  const bucket = configured.length > 0 ? configured : options.fallback;

  if (!PRIVATE_BUCKET_NAME.test(bucket)) {
    throw new PrivateStorageConfigError(
      `Private ${options.kind} storage bucket configuration is invalid.`,
      503,
    );
  }

  if (bucket.toLowerCase() === "club-assets") {
    throw new PrivateStorageConfigError(
      `Private ${options.kind} storage cannot use a public bucket.`,
      503,
    );
  }

  // Defense in depth: configured private buckets must not silently fall back to public buckets.
  // The explicit club-assets reject above is the primary guard; malformed/empty config fails closed.
  return bucket;
}

export function isPrivateBucketConfigSafe(options: {
  configuredValue: string | undefined;
  fallback: string;
}): boolean {
  try {
    resolvePrivateBucket({ ...options, kind: "form" });
    return true;
  } catch {
    return false;
  }
}
