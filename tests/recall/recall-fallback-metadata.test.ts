import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-fallback-test-'));
process.env.CHIBAKO_DATA_DIR = vault;
delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
delete process.env.CHIBAKO_EMBEDDING_API_KEY;

let server: Server;
let hangingUrl = '';
const SECRET_QUERY = 'zebracorn unique secret phrase';

function useOpenAi(baseUrl: string) {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
  process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';
  process.env.CHIBAKO_EMBEDDING_BASE_URL = baseUrl;
}

before(async () => {
  server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  hangingUrl = `http://127.0.0.1:${address.port}/v1`;
  const { createNote } = await import('../../src/lib/notes');
  createNote({ title: 'Zebracorn', content: SECRET_QUERY });
});

after(async () => {
  server.closeAllConnections();
  server.close();
  (await import('../../src/lib/db')).getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

test('disabled embeddings report keyword mode with reason disabled', async () => {
  const { recallDetailed, recall } = await import('../../src/lib/recall');
  const res = await recallDetailed({ query: 'zebracorn' });
  assert.equal(res.mode, 'keyword');
  assert.equal(res.fallback_reason, 'disabled');
  assert.deepEqual(await recall({ query: 'zebracorn' }), res.results, 'results are unchanged');
});

test('a provider error returns keyword results with reason provider_error and is counted', async () => {
  useOpenAi('http://127.0.0.1:9/v1');
  const { recallDetailed } = await import('../../src/lib/recall');
  const { embeddingStatus } = await import('../../src/lib/embedding-index');
  const res = await recallDetailed({ query: SECRET_QUERY, refreshStale: false });
  assert.equal(res.mode, 'keyword');
  assert.equal(res.fallback_reason, 'provider_error');
  assert(res.results.some((r) => r.title === 'Zebracorn'));
  const status = embeddingStatus();
  assert.deepEqual(status.query_failures, { timeout: 0, provider_error: 1 });
  assert.deepEqual(status.query_fallbacks, { timeout: 0, provider_error: 1, no_vectors: 0 });
  assert.equal(status.last_query_failure_reason, 'provider_error');
  assert(status.last_query_failure_at && status.last_query_failure_at > 0);
});

test('a provider timeout returns keyword results with reason timeout and is counted', async () => {
  useOpenAi(hangingUrl);
  const { recallDetailed } = await import('../../src/lib/recall');
  const { embeddingStatus } = await import('../../src/lib/embedding-index');
  const res = await recallDetailed({ query: SECRET_QUERY, refreshStale: false });
  assert.equal(res.mode, 'keyword');
  assert.equal(res.fallback_reason, 'timeout');
  assert(res.results.some((r) => r.title === 'Zebracorn'));
  const status = embeddingStatus();
  assert.deepEqual(status.query_failures, { timeout: 1, provider_error: 1 });
  assert.equal(status.last_query_failure_reason, 'timeout');
});

test('a working provider with no stored vectors reports no_vectors without counting a failure', async () => {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  delete process.env.CHIBAKO_EMBEDDING_API_KEY;
  const { recallDetailed } = await import('../../src/lib/recall');
  const { embeddingStatus } = await import('../../src/lib/embedding-index');
  const res = await recallDetailed({ query: SECRET_QUERY, refreshStale: false });
  assert.equal(res.mode, 'keyword');
  assert.equal(res.fallback_reason, 'no_vectors');
  const status = embeddingStatus();
  assert.deepEqual(status.query_failures, { timeout: 1, provider_error: 1 });
  assert.deepEqual(status.query_fallbacks, { timeout: 1, provider_error: 1, no_vectors: 1 });
});

test('with fresh vectors recall is hybrid with no fallback reason', async () => {
  const { recallDetailed } = await import('../../src/lib/recall');
  const { reindexEmbeddings, embeddingStatus } = await import('../../src/lib/embedding-index');
  await reindexEmbeddings();
  const before = embeddingStatus();
  const res = await recallDetailed({ query: SECRET_QUERY, refreshStale: false });
  assert.equal(res.mode, 'hybrid');
  assert.equal(res.fallback_reason, null);
  assert.deepEqual(embeddingStatus().query_fallbacks, before.query_fallbacks);
});

test('query text is never stored', async () => {
  const { getDb } = await import('../../src/lib/db');
  const rows = getDb().prepare(`SELECT value FROM settings`).all() as Array<{ value: string }>;
  assert(rows.length > 0);
  for (const row of rows) assert(!row.value.toLowerCase().includes('zebracorn'), 'query text found in settings');
});
