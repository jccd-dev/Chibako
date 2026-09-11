import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('a provider failure leaves notes writable, records the error, and recall degrades to keywords', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-fail-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
  process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';
  process.env.CHIBAKO_EMBEDDING_BASE_URL = 'http://127.0.0.1:9/v1';
  const { createNote } = await import('../src/lib/notes');
  const { reindexEmbeddings, embeddingStatus } = await import('../src/lib/embedding-index');
  const { recall } = await import('../src/lib/recall');
  const { getDb } = await import('../src/lib/db');
  try {
    const note = createNote({ title: 'Auth', content: 'token validation happens here' });
    assert(note.id, 'note write succeeded despite the broken provider');

    const res = await reindexEmbeddings();
    assert.equal(res.indexed, 0);
    assert(embeddingStatus().last_error, 'failure recorded');

    const results = await recall({ query: 'token validation' });
    assert(results.some((r) => r.title === 'Auth'), 'recall still returns keyword results');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
