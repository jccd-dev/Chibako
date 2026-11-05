import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { sessionMemory } from '../../src/features/memory/session-memory';
import { getDb } from '../../src/lib/db';
import { createNote, listNotes, searchNotes } from '../../src/lib/notes';
import { recall } from '../../src/lib/recall';
import type { ApiKeyPrincipal } from '../../src/server/auth/api-key-authorization';

const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-cleaner-'));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = 'Agent Memory';
delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const actor: ApiKeyPrincipal = { id: 'fixture-agent', scopes: ['memory:write', 'notes:read'] };
const identity = { runtime: 'claude', session_id: 'cleaner', project: 'atlas' };
const TERM = 'quillfeather';

test('Recall skips Activity notes and Agent Now but Search and the Note list still show them', async () => {
  // A checkpoint with a now_line creates Agent Now; an activity capture creates the project's Activity note.
  sessionMemory(actor, { ...identity, action: 'save', workstream: true, request_id: randomUUID(), title: 'Cleaner work', content: `${TERM} checkpoint body`, now_line: `${TERM} next step` });
  sessionMemory(actor, { ...identity, action: 'activity', request_id: randomUUID(), entry: { branch: 'main', head: 'abc1234', files: [`${TERM}.ts`], files_changed: 1, tool_calls: 1, user_turns: 1 } });
  createNote({ title: 'Quill guide', content: `How the ${TERM} parser works` });

  const titles = (await recall({ query: TERM })).map((r) => r.title);
  assert.deepEqual(titles.filter((t) => t === 'Agent Now' || t === 'Activity — atlas'), []);
  assert(titles.includes('Quill guide') && titles.includes('Cleaner work'), 'ordinary notes and checkpoints stay');

  const searched = searchNotes(TERM, []).map((r) => r.title);
  assert(searched.includes('Agent Now') && searched.includes('Activity — atlas'), 'Search is unchanged');
  assert(listNotes().some((n) => n.title === 'Agent Now') && listNotes().some((n) => n.title === 'Activity — atlas'));
});

test('a user note that merely shares the title Activity is not excluded', async () => {
  createNote({ title: 'Activity', folder: 'Elsewhere', content: `${TERM} plain note called Activity` });
  assert((await recall({ query: TERM })).some((r) => r.title === 'Activity' && r.folder === 'Elsewhere'));
});

test('archived notes rank below current ones, stay findable, and items carry their status', async () => {
  const term = 'ravenwing';
  createNote({ title: 'Old ravenwing ravenwing', content: `${term} ${term} ${term}`, properties: { status: 'archived' } });
  createNote({ title: 'Current ravenwing', content: `${term} once`, properties: { status: 'active' } });
  createNote({ title: 'Unlabelled ravenwing', content: `${term} once more` });
  const results = await recall({ query: term });
  const byTitle = Object.fromEntries(results.map((r, i) => [r.title, { status: r.status, rank: i }]));
  assert.equal(byTitle['Old ravenwing ravenwing'].status, 'archived');
  assert.equal(byTitle['Current ravenwing'].status, 'active');
  assert.equal(byTitle['Unlabelled ravenwing'].status, null);
  assert(byTitle['Old ravenwing ravenwing'].rank > byTitle['Current ravenwing'].rank);
  assert(byTitle['Old ravenwing ravenwing'].rank > byTitle['Unlabelled ravenwing'].rank);
});

test('an archived exact-title match survives behind weaker current notes at a small limit, and still ranks below them', async () => {
  const term = 'quokkalore';
  createNote({ title: term, content: `${term} ${term}`, properties: { status: 'archived' } });
  for (let i = 0; i < 6; i++) createNote({ title: `Passing mention ${i}`, content: `${'filler words here '.repeat(80)} ${term} ${'more filler '.repeat(80)}`, properties: { status: 'active' } });
  const results = await recall({ query: term, limit: 5 });
  assert.equal(results.length, 5);
  assert.equal(results[4].title, term, 'archived Note is kept, placed after the current ones');
  assert(results.slice(0, 4).every((r) => r.status === 'active'));
});
