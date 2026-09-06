import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, now } from "./db";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE = "chibako_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function isSetup(): boolean {
  return Boolean(getDb().prepare(`SELECT value FROM settings WHERE key = 'password_hash'`).get());
}

export function requireSetup(): void {
  if (!isSetup()) redirect("/setup");
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

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  created_at: number;
  last_used_at: number | null;
}

export function listApiKeys(): ApiKey[] {
  const rows = getDb()
    .prepare(`SELECT id, name, scopes, created_at, last_used_at FROM api_keys ORDER BY created_at DESC`)
    .all() as Array<{ id: string; name: string; scopes: string; created_at: number; last_used_at: number | null }>;
  return rows.map((r) => ({ ...r, scopes: r.scopes.split(",").filter(Boolean) }));
}

export function createApiKey(name: string, scopes: string[]): { id: string; key: string } {
  const id = randomUUID();
  const key = `ck_${randomBytes(24).toString("hex")}`;
  const db = getDb();
  db.prepare(`INSERT INTO api_keys (id, name, key_hash, scopes, created_at) VALUES (?,?,?,?,?)`).run(
    id, name, createHash("sha256").update(key).digest("hex"), scopes.join(","), now()
  );
  return { id, key };
}

export function revokeApiKey(id: string): void {
  getDb().prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
}

/**
 * Authenticate an API request. Returns scopes array on success, null otherwise.
 * Accepts `Authorization: Bearer <key>` (agent) or the session cookie (web UI).
 */
export function authenticateRequest(authHeader: string | null, sessionToken: string | null): string[] | null {
  if (authHeader?.startsWith("Bearer ")) {
    const raw = authHeader.slice(7).trim();
    const hash = createHash("sha256").update(raw).digest("hex");
    const row = getDb().prepare(`SELECT scopes FROM api_keys WHERE key_hash = ?`).get(hash) as { scopes: string } | undefined;
    if (!row) return null;
    getDb().prepare(`UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`).run(now(), hash);
    return row.scopes.split(",").filter(Boolean);
  }
  if (getSession(sessionToken)) {
    return ["*"];
  }
  return null;
}

export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes("*") || scopes.includes(required);
}