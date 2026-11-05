import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const tokens = (r: { title: string; snippet: string }) => Math.ceil(r.title.length / 4) + Math.ceil(r.snippet.length / 4);

async function withVault(fn: (api: { createNote: typeof import('../../src/lib/notes').createNote; recall: typeof import('../../src/lib/recall').recall }) => Promise<void>) {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-budget-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
  process.env.CHIBAKO_EMBEDDING_API_KEY = '';
  const { createNote } = await import('../../src/lib/notes');
  const { recall } = await import('../../src/lib/recall');
  const { getDb } = await import('../../src/lib/db');
  try {
    await fn({ createNote, recall });
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
}

test('a very long first result is trimmed to fit the budget', async () => {
  await withVault(async ({ createNote, recall }) => {
    // Long unbroken words defeat any word-count limit.
    const filler = 'abcdefghijklmnopqrstuvwxyz'.repeat(40);
    createNote({ title: 'Long', content: `${filler} ${filler} zebrafish ${filler} ${filler}` });
    const results = await recall({ query: 'zebrafish', budget: 100 });
    assert.equal(results.length, 1);
    assert(tokens(results[0]) <= 100, `first result used ${tokens(results[0])} tokens`);
  });
});

test('total tokens across all results stay within the budget', async () => {
  await withVault(async ({ createNote, recall }) => {
    for (let i = 0; i < 6; i++) {
      createNote({ title: `Note ${i}`, content: `${'lorem ipsum '.repeat(120)} zebrafish ${'dolor sit '.repeat(120)}` });
    }
    const results = await recall({ query: 'zebrafish', budget: 300, limit: 6 });
    assert(results.length >= 1);
    assert(results.reduce((sum, r) => sum + tokens(r), 0) <= 300);
  });
});

test('the snippet is centered on the match, not the top of the note', async () => {
  await withVault(async ({ createNote, recall }) => {
    const head = Array.from({ length: 400 }, (_, i) => `head${i}`).join(' ');
    const tail = Array.from({ length: 400 }, (_, i) => `tail${i}`).join(' ');
    createNote({ title: 'Middle', content: `${head} zebrafish ${tail}` });
    const [hit] = await recall({ query: 'zebrafish', budget: 100 });
    assert(hit.snippet.includes('zebrafish'));
    assert(hit.snippet.includes('head399'), 'text before the match is shown');
    assert(hit.snippet.includes('tail0'), 'text after the match is shown');
    assert(!hit.snippet.includes('head0 '), 'the top of the note is not shown');
  });
});
