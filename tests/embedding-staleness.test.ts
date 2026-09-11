import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('editing a note makes its embedding stale until reindexed', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-stale-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { createNote, updateNote, getNoteByTitle } = await import('../src/lib/notes');
  const { reindexEmbeddings, embeddingStatus } = await import('../src/lib/embedding-index');
  const { getDb } = await import('../src/lib/db');
  try {
    createNote({ title: 'Rocket', content: 'ignition sequence' });
    await reindexEmbeddings();
    assert.equal(embeddingStatus().stale, 0, 'fresh after reindex');

    const note = getNoteByTitle('Rocket');
    assert(note);
    updateNote(note.id, { content: 'ignition sequence with a new parachute section' });
    assert.equal(embeddingStatus().stale, 1, 'edited note is stale');

    await reindexEmbeddings();
    assert.equal(embeddingStatus().stale, 0, 'fresh again after reindex');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
