import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('folders persist and organization preserves notes, links, and search atomically', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import('../src/lib/notes');
  const folders = await import('../src/features/organization/folders');
  const organization = await import('../src/features/organization/organization');
  const { getDb } = await import('../src/lib/db');
  try {
    folders.createFolder('Projects/Empty');
    const target = notes.createNote({ title: 'Plan', folder: 'Projects/Work', content: 'launch checklist' });
    const source = notes.createNote({ title: 'Links', content: '[[Plan|the plan]] [[Projects/Work/Plan]]' });
    organization.moveFolder('Projects', 'Archive');
    assert.deepEqual(folders.folderTree(), ['Archive', 'Archive/Empty', 'Archive/Work']);
    assert.equal(notes.getNote(target.id)?.folder, 'Archive/Work');
    assert.equal(notes.getNote(source.id)?.content, '[[Plan|the plan]] [[Archive/Work/Plan]]');
    assert(notes.searchNotes('Archive').some(note => note.id === target.id));
    notes.updateNote(target.id, { title: 'Roadmap' });
    assert.equal(notes.getNote(source.id)?.content, '[[Roadmap|the plan]] [[Archive/Work/Roadmap]]');
    assert(notes.getOutlinks(source.id).every(link => link.target_id === target.id));
    folders.createFolder('Other');
    assert.throws(() => organization.moveFolder('Archive', 'Other'), /exists/);
    assert.throws(() => organization.moveFolder('Archive', 'Archive/Child'), /itself/);
    assert.throws(() => folders.createFolder('../escape'), /Invalid/);
    assert.equal(notes.getNote(target.id)?.folder, 'Archive/Work');
    notes.updateNote(target.id, { folder: '' });
    assert(folders.folderTree().includes('Archive/Work'));
    folders.createFolder("100%_'; DROP TABLE notes;--");
    assert.equal(notes.listNotes().length, 2);
    const other = notes.createNote({ title: 'Roadmap', folder: 'Other' });
    assert.throws(() => notes.updateNote(other.id, { folder: '' }), /exists/);
    assert.equal(notes.getNote(other.id)?.folder, 'Other');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
