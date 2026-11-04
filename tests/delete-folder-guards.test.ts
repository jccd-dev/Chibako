import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('deleteFolder guards: root cannot be deleted, missing folder 404s', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-del-folder2-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const organization = await import('../src/features/organization/organization');
  const { getDb } = await import('../src/lib/db');
  try {
    assert.throws(() => organization.deleteFolder(''), /root/);
    assert.throws(() => organization.deleteFolder('Nope'), /not found/);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test('deleteEmptyFolder removes only folders without live notes', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-del-empty-folder-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const organization = await import('../src/features/organization/organization');
  const { createFolder, folderTree } = await import('../src/features/organization/folders');
  const notes = await import('../src/lib/notes');
  const { getDb } = await import('../src/lib/db');
  try {
    assert.throws(() => organization.deleteEmptyFolder(''), /root/);
    assert.throws(() => organization.deleteEmptyFolder('Nope'), /not found/);

    createFolder('Area/Empty/Nested');
    assert.equal(organization.deleteEmptyFolder('Area/Empty'), 'Area');
    assert.deepEqual(folderTree(), ['Area']);

    const live = notes.createNote({ title: 'Live', folder: 'Area/Busy/Deep', content: 'kept' });
    for (const path of ['Area/Busy/Deep', 'Area/Busy']) {
      assert.throws(() => organization.deleteEmptyFolder(path), (error: Error & { status?: number }) => error.status === 409 && /live notes/.test(error.message));
    }
    assert.equal(notes.getNote(live.id)?.folder, 'Area/Busy/Deep', 'a refused delete moves nothing');
    assert.ok(folderTree().includes('Area/Busy/Deep'));

    // A sibling whose name extends the target must not count as inside it.
    createFolder('Area/Busy2');
    notes.createNote({ title: 'Sibling', folder: 'Area/Busy2/Sub', content: 'kept' });
    createFolder('Area/Bus');
    assert.equal(organization.deleteEmptyFolder('Area/Bus'), 'Area');

    const trashed = notes.createNote({ title: 'Trashed', folder: 'Area/Old', content: 'recoverable' });
    notes.deleteNote(trashed.id);
    assert.equal(organization.deleteEmptyFolder('Area/Old'), 'Area');
    assert.ok(!folderTree().includes('Area/Old'));
    notes.restoreNote(trashed.id);
    assert.equal(notes.getNote(trashed.id)?.folder, 'Area', 'a trashed note restores into the parent');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
