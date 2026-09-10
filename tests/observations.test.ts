import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('observations save/list/delete round-trip', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-obs-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb } = await import('../src/lib/db');
  const { saveObservation, listObservations, deleteObservation } = await import('../src/lib/recall');
  try {
    const a = saveObservation({ content: 'chose jose over jsonwebtoken for edge compat' });
    saveObservation({ content: 'rate limiting lives in src/middleware/auth.ts' });
    const list = listObservations();
    assert.equal(list.length, 2);
    assert.equal(list[0].content, 'rate limiting lives in src/middleware/auth.ts'); // newest first
    assert.equal(list[0].source, 'agent');
    assert(list[0].id, 'has id');
    assert(deleteObservation(a.id));
    assert.equal(listObservations().length, 1);
    assert(!deleteObservation('missing'));
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});