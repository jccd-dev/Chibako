import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-title-'));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
let createNote: typeof import('../../src/lib/notes').createNote;
let recall: typeof import('../../src/lib/recall').recall;
let getDb: typeof import('../../src/lib/db').getDb;
before(async () => {
  ({ createNote } = await import('../../src/lib/notes'));
  ({ recall } = await import('../../src/lib/recall'));
  ({ getDb } = await import('../../src/lib/db'));
});
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

test('a Note whose title covers the query terms outranks a Note that only repeats them in its body', async () => {
  createNote({ title: 'Meeting log', content: 'reverse proxy ssl. '.repeat(40) + 'reverse proxy ssl notes from every standup.' });
  createNote({ title: 'Reverse Proxy and SSL', content: 'Terminate TLS at nginx.' });
  const results = await recall({ query: 'how do I set up a reverse proxy with ssl', limit: 5 });
  assert.equal(results[0].title, 'Reverse Proxy and SSL');
  assert(results.some((r) => r.title === 'Meeting log'), 'the body match stays findable');
});
