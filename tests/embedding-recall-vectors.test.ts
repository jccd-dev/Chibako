import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('embedding vectors let recall surface a match that keyword search misses', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-vec-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { createNote, searchNotes } = await import('../src/lib/notes');
  const { reindexEmbeddings } = await import('../src/lib/embedding-index');
  const { recall } = await import('../src/lib/recall');
  const { getDb } = await import('../src/lib/db');
  try {
    createNote({ title: 'Rocket', content: 'the launch sequence begins at dawn' });
    createNote({ title: 'Groceries', content: 'milk, eggs, bread' });
    await reindexEmbeddings();

    assert.equal(searchNotes('blastoff').length, 0, 'keyword search has no match');

    const results = await recall({ query: 'blastoff', limit: 5 });
    assert(results.some((r) => r.title === 'Rocket'), 'vector half surfaces the semantic match');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
