import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-filler-'));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
let createNote: typeof import('../../src/lib/notes').createNote;
let recall: typeof import('../../src/lib/recall').recall;
let getDb: typeof import('../../src/lib/db').getDb;
before(async () => {
  ({ createNote } = await import('../../src/lib/notes'));
  ({ recall } = await import('../../src/lib/recall'));
  ({ getDb } = await import('../../src/lib/db'));
  createNote({ title: 'Locale files', content: 'i18n message catalogs and a11y checks live here.' });
  createNote({ title: 'Decoy', content: 'the is it in' });
});
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

test('terms like i18n and a11y are not mistaken for the filler words they resemble', async () => {
  for (const query of ['the i18n setup', 'is a11y covered']) {
    assert.deepEqual((await recall({ query, limit: 5 })).map((r) => r.title), ['Locale files'], query);
  }
});

test('punctuation around a filler word does not keep it in the query', async () => {
  assert.deepEqual((await recall({ query: '"the" i18n, in?', limit: 5 })).map((r) => r.title), ['Locale files']);
});
