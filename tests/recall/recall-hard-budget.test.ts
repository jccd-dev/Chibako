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
    assert.equal(results.length, 6, 'every candidate gets a share');
    assert(results.reduce((sum, r) => sum + tokens(r), 0) <= 300);
  });
});

// Story 22: one long Note must not consume the whole allowance. 2000 is the default, 1600 is the hook's.
for (const budget of [undefined, 1600]) {
  test(`several long Notes each get a share of the ${budget ?? 'default'} budget`, async () => {
    await withVault(async ({ createNote, recall }) => {
      for (let i = 0; i < 6; i++) {
        createNote({ title: `Long ${i}`, content: `${'lorem ipsum '.repeat(600)} zebrafish ${'dolor sit '.repeat(600)}` });
      }
      const results = await recall({ query: 'zebrafish', limit: 6, ...(budget ? { budget } : {}) });
      assert.equal(results.length, 6);
      assert(results.reduce((sum, r) => sum + tokens(r), 0) <= (budget ?? 2000));
      assert(results.every((r) => r.snippet.includes('zebrafish')));
    });
  });
}

test('a short Note leaves its unused share to the Notes after it', async () => {
  await withVault(async ({ createNote, recall }) => {
    createNote({ title: 'Short', content: 'zebrafish zebrafish zebrafish zebrafish' });
    createNote({ title: 'Long', content: `${'lorem ipsum '.repeat(600)} zebrafish ${'dolor sit '.repeat(600)}` });
    const results = await recall({ query: 'zebrafish', budget: 400, limit: 2 });
    const long = results.find((r) => r.title === 'Long')!;
    assert(tokens(long) > 200, `the long Note used ${tokens(long)} tokens, more than an even half`);
    assert(results.reduce((sum, r) => sum + tokens(r), 0) <= 400);
  });
});

test('the snippet matches a term followed by punctuation and reports it as matched', async () => {
  await withVault(async ({ createNote, recall }) => {
    const head = Array.from({ length: 400 }, (_, i) => `head${i}`).join(' ');
    createNote({ title: 'Birds', content: `${head} the osprey nests here ${head}` });
    const [hit] = await recall({ query: 'where is the osprey?', budget: 100 });
    assert(hit.snippet.includes('osprey'));
    assert.deepEqual(hit.matched, ['osprey']);
  });
});

test('the snippet shows the area where the query terms sit together, not the first or densest single term', async () => {
  await withVault(async ({ createNote, recall }) => {
    const filler = (tag: string) => Array.from({ length: 300 }, (_, i) => `${tag}${i}`).join(' ');
    createNote({ title: 'Pair', content: `alpha alpha alpha alpha ${filler('a')} alpha beta ${filler('b')}` });
    const [hit] = await recall({ query: 'alpha beta', budget: 100 });
    assert(hit.snippet.includes('alpha beta'), hit.snippet);
    assert(!hit.snippet.includes('a0 '), 'the top of the note is not shown');
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
