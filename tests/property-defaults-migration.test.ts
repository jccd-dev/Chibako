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
    assert.deepEqual(names(), ['status', 'tags', 'layer', 'type', 'category'], 'stored order kept, missing defaults appended once');

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
