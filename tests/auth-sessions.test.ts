import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('destroyOtherSessions keeps the current session and clears the rest', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-auth-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const auth = await import('../src/lib/auth');
  const { getDb } = await import('../src/lib/db');
  try {
    const a = auth.createSession();
    const b = auth.createSession();
    const c = auth.createSession();
    assert.equal(auth.getSession(a), true);
    auth.destroyOtherSessions(b);
    assert.equal(auth.getSession(a), false, 'other sessions are invalidated');
    assert.equal(auth.getSession(b), true, 'current session survives');
    assert.equal(auth.getSession(c), false);
    auth.destroyOtherSessions(null);
    assert.equal(auth.getSession(b), false, 'null token clears everything');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test('the wildcard scope is reachable by sessions but never by API keys', async () => {
  const keyAuth = await import('../src/server/auth/api-key-authorization');
  assert.equal(keyAuth.hasScope(['*'], '*'), true);
  assert.equal(keyAuth.hasScope(['keys:write', 'notes:write'], '*'), false);
});

test("recovery session validation reads the existing vault without migrations or writes", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-recovery-auth-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const auth = await import("../src/lib/auth");
  const { getDb, openReadOnlyDb, maintenanceMarkerPath, MaintenanceError } = await import("../src/lib/db");
  try {
    assert.equal(auth.getSessionReadOnly("missing-vault-token"), false, "a missing vault is not created");
    assert.deepEqual(readdirSync(vault), [], "read-only authentication cannot create a missing database");
    const valid = auth.createSession();
    const revoked = auth.createSession();
    auth.destroySession(revoked);
    const db = getDb();
    db.prepare("INSERT INTO sessions (token, created_at, expires_at) VALUES (?, 0, 0)").run("expired-test-session");
    db.pragma("user_version = 0");
    const before = db.serialize();
    writeFileSync(maintenanceMarkerPath(), "test-recovery-operation");
    assert.equal(auth.getSessionReadOnly(valid), true);
    for (const token of [undefined, "invalid-test-session", revoked, "expired-test-session"]) {
      assert.equal(auth.getSessionReadOnly(token), false);
    }
    assert.throws(() => getDb(), MaintenanceError);
    assert.throws(() => auth.createSession(), MaintenanceError);
    const readOnly = openReadOnlyDb();
    try {
      assert.throws(() => readOnly.prepare("DELETE FROM sessions").run(), /readonly/);
    } finally {
      readOnly.close();
    }
    assert.deepEqual(db.serialize(), before, "session reads do not migrate, clean up expired sessions, or mutate data");
    db.close();
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
