import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('writes refresh through the debounced queue and purge removes embedding rows', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-lifecycle-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { createNote, deleteNote, purgeNote, getNoteByTitle } = await import('../src/lib/notes');
  const { flushEmbeddingQueue } = await import('../src/lib/embedding-queue');
  const { embeddingStatus } = await import('../src/lib/embedding-index');
  const { getDb } = await import('../src/lib/db');
  try {
    createNote({ title: 'Rocket', content: 'ignition' });
    createNote({ title: 'Other', content: 'groceries' });
    await flushEmbeddingQueue();

    let s = embeddingStatus();
    assert.equal(s.indexed, 2, 'both notes embedded by the flush');
    assert.equal(s.stale, 0);
    assert.equal(s.rows, 2);

    const other = getNoteByTitle('Other');
    assert(other);
    deleteNote(other.id);
    purgeNote(other.id);

    s = embeddingStatus();
    assert.equal(s.rows, 1, 'purged note left no embedding row');
    assert.equal(s.total, 1);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
