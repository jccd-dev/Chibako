import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('recall matches a natural sentence query against a shorter note', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-sentence-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
  const { createNote, searchNotes } = await import('../../src/lib/notes');
  const { recall } = await import('../../src/lib/recall');
  const { getDb } = await import('../../src/lib/db');
  try {
    createNote({ title: 'Agent memory handoff', content: 'Where the pilot stopped.' });
    createNote({ title: 'Groceries', content: 'eggs and milk' });
    const results = await recall({ query: 'Continue the agent memory pilot for Hermes OR NOT', limit: 5 });
    assert.equal(results[0]?.title, 'Agent memory handoff');
    assert(!results.some((r) => r.title === 'Groceries'));
    // UI search keeps all-terms semantics.
    assert.equal(searchNotes('Continue the agent memory pilot for Hermes').length, 0);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
