import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";

export type Scope = string;

export interface ApiKeyPrincipal {
  scopes: Scope[];
}

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  created_at: number;
  last_used_at: number | null;
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Authenticate a raw API key and record use for every recognized key. */
export function authenticateApiKey(rawKey: string): ApiKeyPrincipal | null {
  const hash = hashApiKey(rawKey);
  const row = getDb().prepare("SELECT scopes FROM api_keys WHERE key_hash = ?").get(hash) as { scopes: string } | undefined;
  if (!row) return null;
  getDb().prepare("UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?").run(now(), hash);
  return { scopes: row.scopes.split(",").filter(Boolean) };
}

export function hasScope(scopes: readonly Scope[], required: Scope): boolean {
  return scopes.includes("*") || scopes.includes(required);
}

export function hasAnyScope(scopes: readonly Scope[], required: readonly Scope[]): boolean {
  return required.some((scope) => hasScope(scopes, scope));
}

export function listApiKeys(): ApiKey[] {
  const rows = getDb()
    .prepare("SELECT id, name, scopes, created_at, last_used_at FROM api_keys ORDER BY created_at DESC")
    .all() as Array<{ id: string; name: string; scopes: string; created_at: number; last_used_at: number | null }>;
  return rows.map((row) => ({ ...row, scopes: row.scopes.split(",").filter(Boolean) }));
}

export function createApiKey(name: string, scopes: string[]): { id: string; key: string } {
  const id = randomUUID();
  const key = `ck_${randomBytes(24).toString("hex")}`;
  getDb()
    .prepare("INSERT INTO api_keys (id, name, key_hash, scopes, created_at) VALUES (?,?,?,?,?)")
    .run(id, name, hashApiKey(key), scopes.join(","), now());
  return { id, key };
}

export function revokeApiKey(id: string): void {
  getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}
