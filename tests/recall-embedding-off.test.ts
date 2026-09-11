import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('recall without embeddings never calls network and is deterministic', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall2-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
  process.env.CHIBAKO_EMBEDDING_API_KEY = '';
  const { createNote } = await import('../src/lib/notes');
  const { recall } = await import('../src/lib/recall');
  const { embeddingStatus } = await import('../src/lib/embedding-index');
  const { getDb } = await import('../src/lib/db');
  try {
    createNote({ title: 'Auth middleware', content: 'token validation happens here with jose' });
    const status = embeddingStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.provider, 'disabled');
    const results = await recall({ query: 'auth token validation' });
    assert(results.some((r) => r.title === 'Auth middleware'));
    assert(results.every((r) => r.matched.length > 0), 'matched terms populated');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});