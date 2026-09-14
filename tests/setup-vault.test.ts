import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("setup vault initializes settings and bootstrap notes once", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-setup-vault-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { setupVault, VaultAlreadySetupError } = await import("../src/server/setup-vault");
  const password = await import("../src/server/auth/password-authentication");
  const notes = await import("../src/lib/notes");
  const { getDb } = await import("../src/lib/db");
  try {
    setupVault("correct horse battery staple");
    const stored = password.getPasswordHash();
    assert.ok(stored);
    assert.equal(password.verifyPassword("correct horse battery staple", stored), true);
    assert.equal((getDb().prepare("SELECT value FROM settings WHERE key = 'site_name'").get() as { value: string }).value, "Chibako");
    assert.deepEqual(notes.listNotes().map((note) => note.title), ["Home", "Obsidian-style linking", "Setup & deployment"]);
    assert.throws(() => setupVault("another password"), VaultAlreadySetupError);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
