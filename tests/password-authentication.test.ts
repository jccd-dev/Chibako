import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("password capability owns hashing and password persistence", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-password-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const password = await import("../src/server/auth/password-authentication");
  const { getDb } = await import("../src/lib/db");
  try {
    assert.equal(password.isSetup(), false);
    const stored = password.hashPassword("correct horse battery staple");
    assert.equal(password.verifyPassword("correct horse battery staple", stored), true);
    assert.equal(password.verifyPassword("wrong", stored), false);
    assert.equal(password.verifyPassword("wrong", "not-a-password-hash"), false);

    password.initializePassword("correct horse battery staple");
    assert.equal(password.isSetup(), true);
    const first = password.getPasswordHash();
    assert.ok(first);
    assert.equal(password.verifyPassword("correct horse battery staple", first), true);

    password.setPassword("new correct password");
    const second = password.getPasswordHash();
    assert.ok(second);
    assert.notEqual(second, first);
    assert.equal(password.verifyPassword("new correct password", second), true);
    assert.equal(password.verifyPassword("correct horse battery staple", second), false);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM settings WHERE key = 'password_hash'").get() as { count: number }).count, 1);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
