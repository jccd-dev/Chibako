import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('deleteFolder moves notes up one level, preserving subfolders', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-del-folder-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import('../src/lib/notes');
  const { getDb } = await import('../src/lib/db');
  try {
    notes.createFolder('Projects/Work/Deep');
    const direct = notes.createNote({ title: 'Direct', folder: 'Projects/Work', content: 'x' });
    const deep = notes.createNote({ title: 'Deep', folder: 'Projects/Work/Deep', content: 'y' });
    const sibling = notes.createNote({ title: 'Sibling', folder: 'Projects', content: 'z' });
    const root = notes.createNote({ title: 'Root', content: 'r' });

    assert.deepEqual(notes.folderTree(), ['Projects', 'Projects/Work', 'Projects/Work/Deep']);
    const parent = notes.deleteFolder('Projects/Work');

    assert.equal(parent, 'Projects');
    // Deleted folder + its empty subfolders are gone; "Projects/Deep" survives
    // because a note now lives there.
    assert.deepEqual(notes.folderTree(), ['Projects', 'Projects/Deep']);
    // Notes moved up preserving hierarchy
    assert.equal(notes.getNote(direct.id)?.folder, 'Projects');
    assert.equal(notes.getNote(deep.id)?.folder, 'Projects/Deep');
    // Untouched notes stay put
    assert.equal(notes.getNote(sibling.id)?.folder, 'Projects');
    assert.equal(notes.getNote(root.id)?.folder, '');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});