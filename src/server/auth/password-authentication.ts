import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "../../lib/db";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const PASSWORD_HASH_KEY = "password_hash";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const candidate = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function getPasswordHash(): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(PASSWORD_HASH_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function isSetup(): boolean {
  return getPasswordHash() !== null;
}

export function initializePassword(password: string): void {
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(PASSWORD_HASH_KEY, hashPassword(password));
}

export function setPassword(password: string): void {
  getDb().prepare("UPDATE settings SET value = ? WHERE key = ?").run(hashPassword(password), PASSWORD_HASH_KEY);
}
