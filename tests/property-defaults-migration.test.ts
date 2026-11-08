import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('existing vaults pick up new default properties once, then can delete them', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-property-migration-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb } = await import('../src/lib/db');
  const { getPropertyDefs, setPropertyDefs } = await import('../src/lib/properties');
  try {
    // Simulate a vault that saved its dictionary before layer/type existed.
    getDb()
      .prepare("INSERT INTO settings (key, value) VALUES ('property_schema', ?)")
      .run(JSON.stringify([
        { name: 'status', type: 'select', options: ['draft', 'active', 'done', 'archived'] },
        { name: 'tags', type: 'tags' },
      ]));

    const names = () => getPropertyDefs().map((def) => def.name);
    assert(names().includes('layer'), 'layer merged in for an existing vault');
    assert(names().includes('type'), 'type merged in for an existing vault');
    assert.deepEqual(names(), ['status', 'tags', 'layer', 'type', 'priority', 'category'], 'stored order kept, missing defaults appended once');
    assert.deepEqual(getPropertyDefs()[0].options, ['draft', 'active', 'done', 'archived'], 'a select status keeps its own options');

    // Reading again must not re-merge or duplicate.
    assert.deepEqual(names(), names());

    // Deletion still works after the migration ran.
    setPropertyDefs(getPropertyDefs().filter((def) => def.name !== 'layer'));
    assert(!names().includes('layer'), 'a migrated default can still be deleted');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test('v2 vaults get a select status and priority once, without resurrecting deleted defaults', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-property-migration-v3-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb } = await import('../src/lib/db');
  const { getPropertyDefs, setPropertyDefs } = await import('../src/lib/properties');
  try {
    const insert = getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    // A v2 vault that typed status as free text and deleted `layer`.
    insert.run('property_schema', JSON.stringify([
      { name: 'status', type: 'string' },
      { name: 'type', type: 'select', options: ['entity'] },
      { name: 'tags', type: 'tags' },
    ]));
    insert.run('property_defaults_version', '2');

    const defs = getPropertyDefs();
    assert.deepEqual(defs.map((d) => d.name), ['status', 'type', 'tags', 'priority'], 'priority added, deleted layer/category stay deleted');
    assert.deepEqual(defs[0], { name: 'status', type: 'select', options: ['Not started', 'In progress', 'Done'] });
    assert.deepEqual(defs[3], { name: 'priority', type: 'select', options: ['Low', 'Medium', 'High'] });
    assert.deepEqual(defs[1].options, ['entity', 'task'], 'task added to a select type');

    // Exactly once: the owner can turn status back into text and it stays that way.
    setPropertyDefs(defs.map((d) => d.name === 'status' ? { name: 'status', type: 'string' } : d));
    assert.equal(getPropertyDefs()[0].type, 'string');
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test('v3 vaults get task added to a select type exactly once', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-property-migration-v4-test-'));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb } = await import('../src/lib/db');
  const { getPropertyDefs, setPropertyDefs } = await import('../src/lib/properties');
  try {
    const insert = getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    insert.run('property_schema', JSON.stringify([
      { name: 'type', type: 'select', options: ['entity', 'concept'] },
      { name: 'status', type: 'select', options: ['Not started', 'Done'] },
    ]));
    insert.run('property_defaults_version', '3');

    const defs = getPropertyDefs();
    assert.deepEqual(defs.map((d) => d.name), ['type', 'status'], 'no deleted defaults resurrected');
    assert.deepEqual(defs[0].options, ['entity', 'concept', 'task']);
    assert.deepEqual(defs[1].options, ['Not started', 'Done'], 'status options untouched');

    // Exactly once: the owner can remove task again and it stays removed.
    setPropertyDefs(defs.map((d) => d.name === 'type' ? { ...d, options: ['entity', 'concept'] } : d));
    assert.deepEqual(getPropertyDefs()[0].options, ['entity', 'concept']);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
