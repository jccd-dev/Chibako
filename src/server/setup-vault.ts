import { getDb } from "../lib/db";
import { ensureIndexNote } from "../lib/notes";
import { initializePassword, isSetup } from "./auth/password-authentication";

export class VaultAlreadySetupError extends Error {
  constructor() {
    super("Already set up.");
    this.name = "VaultAlreadySetupError";
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
export function setupVault(password: string): void {
  if (isSetup()) throw new VaultAlreadySetupError();
  initializePassword(password);
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("site_name", "Chibako");
  ensureIndexNote();
}
