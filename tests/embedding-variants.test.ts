import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

let vault: string;
let notes: typeof import('../src/lib/notes');
let index: typeof import('../src/lib/embedding-index');
let db: typeof import('../src/lib/db');

before(async () => {
  vault = mkdtempSync(join(tmpdir(), 'chibako-variants-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  notes = await import('../src/lib/notes');
  index = await import('../src/lib/embedding-index');
  db = await import('../src/lib/db');
});

after(() => {
  db.getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

test('renaming a note makes its embedding stale', async () => {
  notes.createNote({ title: 'Old Name', content: 'stable body' });
  await index.reindexEmbeddings();
  const note = notes.getNoteByTitle('Old Name');
  assert(note);
  notes.updateNote(note.id, { title: 'New Name' });
  assert.equal(index.embeddingStatus().stale, 1);
});

test('moving a note between folders keeps its embedding fresh', async () => {
  notes.createNote({ title: 'Mover', folder: 'A', content: 'body text' });
  await index.reindexEmbeddings();
  assert.equal(index.embeddingStatus().stale, 0);
  const note = notes.getNoteByTitle('Mover');
  assert(note);
  notes.updateNote(note.id, { folder: 'B' });
  assert.equal(index.embeddingStatus().stale, 0, 'folder is not part of the embedding input');
});

test('frontmatter-only property edits keep the embedding fresh', async () => {
  notes.createNote({ title: 'Propped', content: 'body text' });
  await index.reindexEmbeddings();
  const note = notes.getNoteByTitle('Propped');
  assert(note);
  notes.updateNote(note.id, { properties: { status: 'active' } });
  assert.equal(index.embeddingStatus().stale, 0);
});

test('refreshNotes hash-skips notes that are already fresh', async () => {
  notes.createNote({ title: 'Skipper', content: 'unchanged' });
  await index.reindexEmbeddings();
  const note = notes.getNoteByTitle('Skipper');
  assert(note);
  assert.equal(await index.refreshNotes([note.id]), 0, 'no provider work for a fresh note');
});

test('switching the model wipes old vectors and reindexes', async () => {
  process.env.CHIBAKO_EMBEDDING_MODEL = 'fake-model-a';
  notes.createNote({ title: 'Switchy', content: 'model switch body' });
  await index.reindexEmbeddings();
  assert.equal(index.embeddingStatus().model, 'fake-model-a');
  assert(index.embeddingStatus().rows > 0);

  process.env.CHIBAKO_EMBEDDING_MODEL = 'fake-model-b';
  const res = await index.reindexEmbeddings();
  assert.equal(index.embeddingStatus().model, 'fake-model-b');
  assert.equal(index.embeddingStatus().stale, 0);
  assert(res.indexed > 0, 'repopulated under the new model');
  delete process.env.CHIBAKO_EMBEDDING_MODEL;
});

test('reindex is batched and reports remaining for the caller to loop', async () => {
  await index.reindexEmbeddings();
  notes.createNote({ title: 'B1', content: 'one' });
  notes.createNote({ title: 'B2', content: 'two' });
  notes.createNote({ title: 'B3', content: 'three' });

  const first = await index.reindexEmbeddings({ max: 2 });
  assert.equal(first.indexed, 2);
  assert.equal(first.remaining, 1);

  const second = await index.reindexEmbeddings({ max: 2 });
  assert.equal(second.remaining, 0);
});
