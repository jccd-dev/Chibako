import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('search tolerates a query whose 60-char slice ends in whitespace', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-search-slice-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
  process.env.CHIBAKO_EMBEDDING_API_KEY = '';
  const { createNote, searchNotes } = await import('../src/lib/notes');
  const { getDb } = await import('../src/lib/db');
  try {
    createNote({ title: 'Rocket', content: 'ignition sequence and launch pads' });
    // 66 chars: the internal 60-char slice lands after a space, which used to
    // produce an empty term and a bare `*` — an FTS5 syntax error.
    const query = 'Chibako vault structure kind wiki index properties tags rag layers';
    assert.doesNotThrow(() => searchNotes(query));
    assert.deepEqual(searchNotes('   '), [], 'whitespace-only query returns no matches');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
