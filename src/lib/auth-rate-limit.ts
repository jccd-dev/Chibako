const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

let windowStartedAt = 0;
let attempts = 0;

export interface AuthAttemptResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Bound unauthenticated login/setup work in this process. This deliberately
 * does not inspect forwarding headers: the app must not trust client-supplied
 * identity, and the single bucket stays bounded without an address map.
 *
 * A multi-process deployment needs a shared or proxy-level limiter before it
 * can rely on a process-local bucket as a global limit.
 */
export function consumeAuthAttempt(timestamp = Date.now()): AuthAttemptResult {
  if (windowStartedAt === 0 || timestamp - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = timestamp;
    attempts = 0;
  }

  if (attempts < MAX_ATTEMPTS + 1) attempts += 1;
  if (attempts <= MAX_ATTEMPTS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + WINDOW_MS - timestamp) / 1000)),
  };
}

/** Reset the in-memory bucket for isolated tests and local process restarts. */
export function resetAuthAttemptLimiter(): void {
  windowStartedAt = 0;
  attempts = 0;
}
