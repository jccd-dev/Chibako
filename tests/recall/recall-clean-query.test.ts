import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-clean-'));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_EMBEDDING_PROVIDER = '';
let createNote: typeof import('../../src/lib/notes').createNote;
let searchNotes: typeof import('../../src/lib/notes').searchNotes;
let recall: typeof import('../../src/lib/recall').recall;
let getDb: typeof import('../../src/lib/db').getDb;
before(async () => {
  ({ createNote, searchNotes } = await import('../../src/lib/notes'));
  ({ recall } = await import('../../src/lib/recall'));
  ({ getDb } = await import('../../src/lib/db'));
});
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

test('filler words in English and Tagalog do not pull in unrelated notes', async () => {
  createNote({ title: 'Webhook retries', content: 'Retry the webhook with backoff.' });
  createNote({ title: 'Trip packing', content: 'What to do with the bags and the tickets for ang biyahe.' });
  for (const query of ['what is the webhook retry', 'ano ang webhook retry sa amin']) {
    const results = await recall({ query, limit: 5 });
    assert.deepEqual(results.map((r) => r.title), ['Webhook retries'], query);
  }
});

test('a query made only of filler words falls back to the original terms', async () => {
  const results = await recall({ query: 'what is the', limit: 5 });
  assert.equal(results[0]?.title, 'Trip packing');
});

test('exact Search keeps filler words', () => {
  assert.deepEqual(searchNotes('what is the webhook').map((r) => r.title), []);
  assert.deepEqual(searchNotes('what to do').map((r) => r.title), ['Trip packing']);
});

test('the project hint boosts Notes in that project without being search text', async () => {
  createNote({ title: 'Deploy checklist', folder: 'Agent Memory/other', content: 'Deploy checklist steps for release.' });
  createNote({ title: 'Deploy checklist', folder: 'Agent Memory/atlas', content: 'Deploy checklist steps for release.' });
  const plain = await recall({ query: 'deploy checklist release', limit: 5 });
  const hinted = await recall({ query: 'deploy checklist release', project: 'atlas', limit: 5 });
  assert.equal(hinted[0].folder, 'Agent Memory/atlas');
  assert.deepEqual(new Set(hinted.map((r) => r.id)), new Set(plain.map((r) => r.id)), 'a boost reorders, never adds or removes');
  // The hint is never search text: a project name that only a Note title carries does not match it.
  createNote({ title: 'Atlas travel notes', content: 'Maps of the world.' });
  const none = await recall({ query: 'deploy checklist release', project: 'atlas', limit: 10 });
  assert(!none.some((r) => r.title === 'Atlas travel notes'));
});
