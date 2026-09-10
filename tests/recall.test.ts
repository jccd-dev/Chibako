import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('recall returns token-budgeted ranked snippets, never full bodies', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
  process.env.CHIBAKO_EMBEDDING_API_KEY = '';
  const { createNote, getNote, getNoteByTitle } = await import('../src/lib/notes');
  const { recall } = await import('../src/lib/recall');
  const { getDb } = await import('../src/lib/db');
  try {
    const long = 'launch '.repeat(1000); // 2000 words, big body
    createNote({ title: 'Rocket', content: `ignition sequence ${long}` });
    createNote({ title: 'Other', content: 'unrelated grocery list' });
    createNote({ title: 'Third', content: 'also launch pads and ignition notes' });

    const results = await recall({ query: 'ignition launch', budget: 300, limit: 10 });
    assert(results.length > 0, 'expected at least one result');
    assert(results.some((r) => r.title === 'Rocket' || r.title === 'Third'), 'expected relevant notes');
    for (const r of results) {
      assert(r.id, 'result has id');
      assert(r.title, 'result has title');
      assert(r.snippet, 'result has snippet');
      assert(r.score > 0, 'result has positive score');
      assert(r.matched.length > 0, 'matched terms populated');
    }
    // the big note must be trimmed, never returned in full
    const rocket = getNoteByTitle('Rocket');
    assert(rocket, 'rocket note exists');
    const rocketHit = results.find((r) => r.id === rocket.id);
    if (rocketHit) {
      assert(rocketHit.snippet.length < rocket.content.length, 'large body must be trimmed');
    }
    // budget is respected: total chars across results stay near budget
    const totalChars = results.reduce((sum, r) => sum + r.title.length + r.snippet.length, 0);
    assert(totalChars < 300 * 6, `budget blown: ${totalChars} chars`);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});