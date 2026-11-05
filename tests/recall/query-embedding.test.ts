import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, mock, test } from 'node:test';
import type { EmbeddingProvider } from '../../src/lib/embeddings';

const vault = mkdtempSync(join(tmpdir(), 'chibako-query-embedding-test-'));
process.env.CHIBAKO_DATA_DIR = vault;
delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;

let server: Server;
let delayMs = 0;
let failNext = 0;
let queryCalls = 0;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const input = JSON.parse(body).input as string[];
      const isQuery = input[0] === 'slow query words';
      if (isQuery) queryCalls++;
      const reply = () => {
        if (isQuery && failNext > 0) {
          failNext--;
          res.writeHead(500).end('boom');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: input.map(() => ({ embedding: [1, 0, 0, 0] })) }));
      };
      if (isQuery && delayMs) setTimeout(reply, delayMs);
      else reply();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
  process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';
  process.env.CHIBAKO_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const { createNote } = await import('../../src/lib/notes');
  const { reindexEmbeddings } = await import('../../src/lib/embedding-index');
  createNote({ title: 'Slow note', content: 'slow query words appear here' });
  assert.equal((await reindexEmbeddings()).indexed, 1);
});

afterEach(async () => {
  delayMs = 0;
  failNext = 0;
  queryCalls = 0;
  delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
  (await import('../../src/lib/query-embedding')).clearQueryEmbeddingCache();
});

after(async () => {
  server.closeAllConnections();
  server.close();
  (await import('../../src/lib/db')).getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

test('timeout env var accepts positive integers up to 30000 and falls back to 4000 otherwise', async () => {
  const { queryEmbedTimeoutMs } = await import('../../src/lib/query-embedding');
  const cases: Array<[string | undefined, number]> = [
    [undefined, 4000], ['', 4000], ['2500', 2500], [' 30000 ', 30000], ['1', 1],
    ['0', 4000], ['-5', 4000], ['1.5', 4000], ['abc', 4000], ['30001', 4000], ['1e3', 4000],
  ];
  for (const [raw, expected] of cases) {
    if (raw === undefined) delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
    else process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = raw;
    assert.equal(queryEmbedTimeoutMs(), expected, `value ${JSON.stringify(raw)}`);
  }
});

test('a slow provider times out within the limit, then its late vector makes the same query instant', async () => {
  process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = '150';
  delayMs = 500;
  const { recallDetailed } = await import('../../src/lib/recall');

  const start = performance.now();
  const first = await recallDetailed({ query: 'slow query words', refreshStale: false });
  assert(performance.now() - start < 450, 'recall returned at the limit, not at provider speed');
  assert.equal(first.mode, 'keyword');
  assert.equal(first.fallback_reason, 'timeout');
  assert(first.results.some((r) => r.title === 'Slow note'));

  await new Promise((r) => setTimeout(r, 600));
  const second = await recallDetailed({ query: '  slow   query words ', refreshStale: false });
  assert.equal(second.mode, 'hybrid');
  assert.equal(second.fallback_reason, null);
  assert.equal(queryCalls, 1, 'the second query came from the cache');
});

test('a failed provider call is not cached and reports provider_error', async () => {
  failNext = 1;
  const { recallDetailed } = await import('../../src/lib/recall');
  const first = await recallDetailed({ query: 'slow query words', refreshStale: false });
  assert.equal(first.fallback_reason, 'provider_error');
  const second = await recallDetailed({ query: 'slow query words', refreshStale: false });
  assert.equal(second.mode, 'hybrid');
  assert.equal(queryCalls, 2, 'the failure was retried, not cached');
});

function countingProvider(model = 'm'): EmbeddingProvider & { calls: number } {
  const p = { id: 'fake', model, dim: 2, calls: 0, embed: async (t: string[]) => { p.calls++; return t.map(() => [1, 0]); } };
  return p;
}

test('the cache is keyed by provider, model and text, bounded, and expires', async () => {
  const { embedQuery, QUERY_CACHE_MAX, QUERY_CACHE_MAX_CHARS, QUERY_CACHE_TTL_MS } = await import('../../src/lib/query-embedding');
  const a = countingProvider('a');
  const b = countingProvider('b');
  await embedQuery(a, 'q');
  await embedQuery(a, ' q ');
  await embedQuery(b, 'q');
  assert.equal(a.calls, 1);
  assert.equal(b.calls, 1, 'a different model does not share entries');

  const c = countingProvider('c');
  const long = 'x'.repeat(QUERY_CACHE_MAX_CHARS + 1);
  await embedQuery(c, long);
  await embedQuery(c, long);
  assert.equal(c.calls, 2, 'queries over the length cap are embedded but never cached');

  for (let i = 0; i < QUERY_CACHE_MAX; i++) await embedQuery(a, `fill ${i}`);
  await embedQuery(a, 'q');
  assert.equal(a.calls, QUERY_CACHE_MAX + 2, 'the oldest entry was evicted once the cache was full');

  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    await embedQuery(a, 'ttl');
    mock.timers.tick(QUERY_CACHE_TTL_MS - 1);
    await embedQuery(a, 'ttl');
    const before = a.calls;
    mock.timers.tick(2);
    await embedQuery(a, 'ttl');
    assert.equal(a.calls, before + 1, 'entry expired after the TTL');
  } finally {
    mock.timers.reset();
  }
});
