import { createHash } from "node:crypto";
import { getDb } from "./db";

const MAX_ATTEMPTS = 5;
const MAX_VAULT_ATTEMPTS = 50;
const WINDOW_MS = 60_000;
const DIRECT_CLIENT_ID = "direct";

export const AUTH_CLIENT_HEADER = "X-Chibako-Client-IP";

interface AttemptBucket {
  window_started_at: number;
  attempts: number;
}

export interface AuthAttemptResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function normalizeClientId(clientId: string | null | undefined): string {
  const normalized = clientId?.trim();
  return normalized && normalized.length <= 64 ? normalized : DIRECT_CLIENT_ID;
}

/** Enable only behind a proxy that overwrites this header and blocks direct access. */
export function getAuthClientId(request: Request): string {
  return process.env.CHIBAKO_TRUST_PROXY === "true"
    ? normalizeClientId(request.headers.get(AUTH_CLIENT_HEADER))
    : DIRECT_CLIENT_ID;
}

/** All password entry points share persistent client and vault-wide windows. */
export function consumeAuthAttempt(clientId = DIRECT_CLIENT_ID, timestamp = Date.now()): AuthAttemptResult {
  const db = getDb();
  const clientBucket = `client:${createHash("sha256").update(normalizeClientId(clientId)).digest("hex")}`;
  return db.transaction(() => {
    db.prepare("DELETE FROM auth_attempts WHERE window_started_at <= ?").run(timestamp - WINDOW_MS);
    const limits = [["vault", MAX_VAULT_ATTEMPTS], [clientBucket, MAX_ATTEMPTS]] as const;
    let retryAfterSeconds = 0;
    for (const [bucket, limit] of limits) {
      const row = db.prepare("SELECT window_started_at, attempts FROM auth_attempts WHERE bucket = ?")
        .get(bucket) as AttemptBucket | undefined;
      if (row && row.attempts >= limit) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((row.window_started_at + WINDOW_MS - timestamp) / 1000));
      }
    }
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };

    for (const [bucket] of limits) {
      db.prepare(`INSERT INTO auth_attempts (bucket, window_started_at, attempts) VALUES (?, ?, 1)
        ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1`).run(bucket, timestamp);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }).immediate();
}

/** Test-only reset; restarting a process must not clear attempts. */
export function resetAuthAttemptLimiter(): void {
  getDb().prepare("DELETE FROM auth_attempts").run();
}
