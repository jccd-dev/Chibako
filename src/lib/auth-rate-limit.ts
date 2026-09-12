const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const MAX_CLIENT_BUCKETS = 1024;
const DIRECT_CLIENT_ID = "direct";

export const AUTH_CLIENT_HEADER = "X-Chibako-Client-IP";

interface AttemptBucket {
  windowStartedAt: number;
  attempts: number;
}

const buckets = new Map<string, AttemptBucket>();

export interface AuthAttemptResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function normalizeClientId(clientId: string | null | undefined): string {
  const normalized = clientId?.trim();
  return normalized && normalized.length <= 64 ? normalized : DIRECT_CLIENT_ID;
}

/**
 * Read the identity owned by the provided nginx config. Direct/local calls
 * without that header share one fallback bucket; X-Forwarded-For is ignored.
 */
export function getAuthClientId(request: Request): string {
  return normalizeClientId(request.headers.get(AUTH_CLIENT_HEADER));
}

function removeExpiredBuckets(timestamp: number): void {
  for (const [clientId, bucket] of buckets) {
    if (timestamp - bucket.windowStartedAt >= WINDOW_MS) buckets.delete(clientId);
  }
}

function getBucket(clientId: string, timestamp: number): AttemptBucket {
  removeExpiredBuckets(timestamp);
  const existing = buckets.get(clientId);
  if (existing) return existing;

  if (buckets.size >= MAX_CLIENT_BUCKETS) {
    const oldestClientId = buckets.keys().next().value;
    if (oldestClientId !== undefined) buckets.delete(oldestClientId);
  }

  const bucket = { windowStartedAt: timestamp, attempts: 0 };
  buckets.set(clientId, bucket);
  return bucket;
}

/**
 * Bound unauthenticated login/setup work per client in this process. The map
 * is capped and expired buckets are removed on access. A multi-process
 * deployment still needs a shared or trusted-proxy limiter.
 * ponytail: process-local map; use shared state when running multiple workers.
 */
export function consumeAuthAttempt(clientId = DIRECT_CLIENT_ID, timestamp = Date.now()): AuthAttemptResult {
  const bucket = getBucket(normalizeClientId(clientId), timestamp);
  if (bucket.attempts < MAX_ATTEMPTS + 1) bucket.attempts += 1;
  if (bucket.attempts <= MAX_ATTEMPTS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStartedAt + WINDOW_MS - timestamp) / 1000)),
  };
}

/** Reset the in-memory buckets for isolated tests and local process restarts. */
export function resetAuthAttemptLimiter(): void {
  buckets.clear();
}
