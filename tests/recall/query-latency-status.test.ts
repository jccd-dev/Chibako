import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const vault = mkdtempSync(join(tmpdir(), 'chibako-query-latency-test-'));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';

const SECRET_QUERY = 'zebracorn unique secret phrase';
let server: Server;
let delayMs = 0;
let failing = false;

before(async () => {
  server = createServer((req, res) => {
    req.resume();
    setTimeout(() => {
      if (failing) { res.writeHead(500); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.CHIBAKO_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  (await import('../../src/lib/notes')).createNote({ title: 'Zebracorn', content: SECRET_QUERY });
});

beforeEach(async () => {
  delayMs = 0;
  failing = false;
  delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
  (await import('../../src/lib/query-embedding')).clearQueryEmbeddingCache();
  (await import('../../src/lib/embedding-store')).setMeta({ query_latency_ms: [] });
});

after(async () => {
  server.closeAllConnections();
  server.close();
  (await import('../../src/lib/db')).getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

const status = async () => (await import('../../src/lib/embedding-index')).embeddingStatus();
const recallOnce = async (query = SECRET_QUERY) =>
  (await import('../../src/lib/recall')).recallDetailed({ query, refreshStale: false });

test('no answers yet reports zero samples and no figures', async () => {
  assert.deepEqual((await status()).query_latency, { samples: 0, p50_ms: null, p95_ms: null, max_ms: null });
});

test('status reports nearest-rank p50, p95 and max of recorded answers', async () => {
  const { recordQueryLatency } = await import('../../src/lib/embedding-index');
  for (let ms = 100; ms >= 1; ms--) recordQueryLatency(ms);
  assert.deepEqual((await status()).query_latency, { samples: 100, p50_ms: 50, p95_ms: 95, max_ms: 100 });
});

test('only the most recent 200 answers count', async () => {
  const { recordQueryLatency } = await import('../../src/lib/embedding-index');
  for (let i = 0; i < 200; i++) recordQueryLatency(9000);
  for (let i = 0; i < 200; i++) recordQueryLatency(10);
  assert.deepEqual((await status()).query_latency, { samples: 200, p50_ms: 10, p95_ms: 10, max_ms: 10 });
});

test('a provider answer during Recall is timed', async () => {
  delayMs = 40;
  await recallOnce();
  const { samples, p50_ms } = (await status()).query_latency;
  assert.equal(samples, 1);
  assert.ok(p50_ms !== null && p50_ms >= 30, `expected about 40 ms, got ${p50_ms}`);
});

test('an answer that arrives after the time limit is still timed, so the slow tail stays visible', async () => {
  process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = '10';
  delayMs = 80;
  const res = await recallOnce();
  assert.equal(res.fallback_reason, 'timeout');
  assert.equal((await status()).query_latency.samples, 0, 'the answer has not arrived yet');
  for (let i = 0; i < 100 && (await status()).query_latency.samples === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  const { samples, p50_ms } = (await status()).query_latency;
  assert.equal(samples, 1);
  assert.ok(p50_ms !== null && p50_ms >= 70, `expected about 80 ms, got ${p50_ms}`);
});

test('a cached query makes no provider call, so it is not timed', async () => {
  await recallOnce();
  await recallOnce();
  assert.equal((await status()).query_latency.samples, 1);
});

test('a provider error is not timed; it is counted as a failure instead', async () => {
  failing = true;
  const before = (await status()).query_failures.provider_error;
  await recallOnce();
  const after = await status();
  assert.equal(after.query_latency.samples, 0);
  assert.equal(after.query_failures.provider_error, before + 1);
});

test('a model change starts the figures again, so they never mix models', async () => {
  const { recordQueryLatency, reindexEmbeddings } = await import('../../src/lib/embedding-index');
  await reindexEmbeddings();
  recordQueryLatency(5);
  process.env.CHIBAKO_EMBEDDING_MODEL = 'another-model';
  try {
    await reindexEmbeddings();
    assert.equal((await status()).query_latency.samples, 0);
  } finally {
    delete process.env.CHIBAKO_EMBEDDING_MODEL;
  }
});

test('no query text is stored or returned', async () => {
  await recallOnce();
  const { getDb } = await import('../../src/lib/db');
  const stored = getDb().prepare(`SELECT value FROM settings WHERE key = 'embedding_meta'`).get() as { value: string };
  assert.equal((await status()).query_latency.samples, 1);
  assert.doesNotMatch(stored.value, /zebracorn/i);
  assert.doesNotMatch(JSON.stringify(await status()), /zebracorn/i);
});

test('a failure to record latency never breaks a read-only Recall', async () => {
  const { getDb } = await import('../../src/lib/db');
  getDb().exec(`CREATE TRIGGER block_meta BEFORE UPDATE ON settings WHEN NEW.key = 'embedding_meta'
    BEGIN SELECT RAISE(ABORT, 'write refused'); END`);
  try {
    const res = await recallOnce();
    assert.ok(res.results.some((r) => r.title === 'Zebracorn'));
  } finally {
    getDb().exec('DROP TRIGGER block_meta');
  }
  assert.equal((await status()).query_latency.samples, 0);
});
