import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('recall falls back to keywords when the embedding provider never responds', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-timeout-test-'));
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
  process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';
  process.env.CHIBAKO_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const { createNote } = await import('../src/lib/notes');
  const { recall } = await import('../src/lib/recall');
  const { getDb } = await import('../src/lib/db');
  try {
    const note = createNote({ title: 'Auth', content: 'token validation happens here' });
    const start = performance.now();
    const results = await recall({ query: 'token validation', refreshStale: false });
    const elapsed = performance.now() - start;

    assert(results.some((r) => r.id === note.id), 'recall still returns keyword results');
    assert(elapsed < 4000, `recall took ${elapsed} ms instead of falling back within 4000 ms`);
  } finally {
    server.closeAllConnections();
    server.close();
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
