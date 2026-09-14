import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateApiKey } from "../server/auth/api-key-authorization";
import { isSetup as isPasswordSetup } from "../server/auth/password-authentication";
import { getDb, now } from "./db";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE = "chibako_session";

// ---------- passwords ----------

export function requireSetup(): void {
  if (!isPasswordSetup()) redirect("/setup");
}

// ---------- sessions ----------

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  const db = getDb();
  const expires = now() + SESSION_TTL;
  db.prepare(`INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)`).run(token, now(), expires);
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now());
  return token;
}

export function getSession(token: string | undefined | null): boolean {
  if (!token) return false;
  const db = getDb();
  const row = db.prepare(`SELECT expires_at FROM sessions WHERE token = ?`).get(token) as { expires_at: number } | undefined;
  if (!row) return false;
  if (row.expires_at < now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

/**
 * Invalidate every session except the given one. Called after a password
 * change so other devices are logged out but the current session survives.
 * With no current token, all sessions are cleared.
 */
export function destroyOtherSessions(keepToken: string | null): void {
  if (keepToken) {
    getDb().prepare(`DELETE FROM sessions WHERE token != ?`).run(keepToken);
  } else {
    getDb().prepare(`DELETE FROM sessions`).run();
  }
}

export async function getCookieToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Guard for server components / pages. */
export async function requireAuth(): Promise<void> {
  if (!getSession(await getCookieToken())) redirect("/login");
}

// ---------- API keys (agent access) ----------

/**
 * Authenticate an API request. Returns scopes array on success, null otherwise.
 * Accepts `Authorization: Bearer <key>` (agent) or the session cookie (web UI).
 */
export function authenticateRequest(authHeader: string | null, sessionToken: string | null): string[] | null {
  if (authHeader?.startsWith("Bearer ")) {
    const raw = authHeader.slice(7).trim();
    return authenticateApiKey(raw)?.scopes ?? null;
  }
  if (getSession(sessionToken)) {
    return ["*"];
  }
  return null;
}