import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('reindex embeds every eligible note and reports a clean status', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-emb-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { createNote } = await import('../src/lib/notes');
  const { reindexEmbeddings, embeddingStatus } = await import('../src/lib/embedding-index');
  const { getDb } = await import('../src/lib/db');
  try {
    createNote({ title: 'Rocket', content: 'ignition sequence and launch pads' });
    createNote({ title: 'Other', content: 'unrelated grocery list' });

    const before = embeddingStatus();
    assert.equal(before.enabled, true);
    assert.equal(before.total, 2);
    assert.equal(before.indexed, 0);
    assert.equal(before.stale, 2);

    const res = await reindexEmbeddings();
    assert.equal(res.indexed, 2);
    assert.equal(res.remaining, 0);

    const after = embeddingStatus();
    assert.equal(after.indexed, 2);
    assert.equal(after.stale, 0);
    assert.equal(after.model, 'fake-embedding');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
