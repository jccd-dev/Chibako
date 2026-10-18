import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "../lib/db";
import { ensureIndexNote } from "../lib/notes";
import { initializePassword, isSetup } from "./auth/password-authentication";

export class VaultAlreadySetupError extends Error {
  constructor() {
    super("Already set up.");
    this.name = "VaultAlreadySetupError";
  }
}

export class VaultSetupTokenError extends Error {
  constructor() {
    super("Setup token is missing or invalid. Configure CHIBAKO_SETUP_TOKEN on the server before setup.");
    this.name = "VaultSetupTokenError";
  }
}

/**
 * Initialize the first vault settings and bootstrap Notes.
 *
 * Setup is intentionally not one outer transaction: ensureIndexNote owns Note
 * write transactions, and nesting those transactions would make setup depend
 * on SQLite savepoint behavior. Callers should treat a thrown error after the
 * password insert as a partial setup and retry/repair explicitly.
 */
export function setupVault(password: string, setupToken: string | undefined): void {
  if (isSetup()) throw new VaultAlreadySetupError();
  const expected = process.env.CHIBAKO_SETUP_TOKEN;
  if (!expected || expected.length < 32 || !setupToken || !timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(setupToken).digest(),
  )) throw new VaultSetupTokenError();
  initializePassword(password);
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("site_name", "Chibako");
  ensureIndexNote();
}
