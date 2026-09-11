import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
  const auth = await import('../src/lib/auth');
  assert.equal(auth.hasScope(['*'], '*'), true);
  assert.equal(auth.hasScope(['keys:write', 'notes:write'], '*'), false);
});
