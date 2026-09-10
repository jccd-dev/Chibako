import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('deleteFolder guards: root cannot be deleted, missing folder 404s', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-del-folder2-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import('../src/lib/notes');
  const { getDb } = await import('../src/lib/db');
  try {
    assert.throws(() => notes.deleteFolder(''), /root/);
    assert.throws(() => notes.deleteFolder('Nope'), /not found/);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});