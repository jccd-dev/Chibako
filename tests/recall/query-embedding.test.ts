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
delete process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS;

let server: Server;
let delayMs = 0;
let failNext = 0;
let queryCalls = 0;
let callPlan: Array<{ delayMs: number; fail?: boolean }> = []; // one entry per query call, in order; overrides delayMs and failNext

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const input = JSON.parse(body).input as string[];
      const isQuery = input[0] === 'slow query words';
      if (isQuery) queryCalls++;
      const planned = isQuery ? callPlan.shift() : undefined;
      const reply = () => {
        if (planned?.fail || (!planned && isQuery && failNext > 0)) {
          if (!planned) failNext--;
          res.writeHead(500).end('boom');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: input.map(() => ({ embedding: [1, 0, 0, 0] })) }));
      };
      const wait = planned ? planned.delayMs : isQuery ? delayMs : 0;
      if (wait) setTimeout(reply, wait);
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
  callPlan = [];
  delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
  delete process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS;
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

test('retry delay env var accepts 0 to turn the retry off, and falls back to 1500 otherwise', async () => {
  const { queryRetryDelayMs } = await import('../../src/lib/query-embedding');
  const cases: Array<[string | undefined, number]> = [
    [undefined, 1500], ['', 1500], ['2000', 2000], [' 0 ', 0], ['-5', 1500], ['1.5', 1500], ['abc', 1500], ['30001', 1500],
  ];
  for (const [raw, expected] of cases) {
    if (raw === undefined) delete process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS;
    else process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS = raw;
    assert.equal(queryRetryDelayMs(), expected, `value ${JSON.stringify(raw)}`);
  }
});

/** Recall with a 50 ms retry delay and a 600 ms limit, against the planned Provider calls. */
async function recallWithRetry(plan: typeof callPlan) {
  process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS = '50';
  process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = '600';
  callPlan = plan;
  const { recallDetailed } = await import('../../src/lib/recall');
  const start = performance.now();
  const result = await recallDetailed({ query: 'slow query words', refreshStale: false });
  return { result, ms: performance.now() - start };
}

async function figures() {
  const { query_failures, query_failures_rescued } = (await import('../../src/lib/embedding-index')).embeddingStatus();
  return { failures: query_failures.provider_error + query_failures.timeout, rescued: query_failures_rescued };
}

test('a slow first call is rescued by the extra call, and the first answer wins', async () => {
  const { result, ms } = await recallWithRetry([{ delayMs: 2000 }, { delayMs: 0 }]);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.fallback_reason, null);
  assert.equal(queryCalls, 2);
  assert(ms < 500, 'recall took the extra call\'s answer without waiting for the slow one');
});

test('a call that answers before the delay makes no extra call', async () => {
  const { result } = await recallWithRetry([{ delayMs: 0 }]);
  assert.equal(result.mode, 'hybrid');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(queryCalls, 1);
});

test('a first call that fails before the delay is not retried', async () => {
  const { result } = await recallWithRetry([{ delayMs: 0, fail: true }]);
  assert.equal(result.fallback_reason, 'provider_error');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(queryCalls, 1);
});

test('a first call that fails after the extra call started does not fail Recall, and is counted as rescued', async () => {
  const before = await figures();
  const { result } = await recallWithRetry([{ delayMs: 100, fail: true }, { delayMs: 200 }]);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.fallback_reason, null);
  assert.deepEqual(await figures(), { failures: before.failures, rescued: before.rescued + 1 });
});

test('an extra call that fails does not fail Recall while the first can still answer, and is counted as rescued', async () => {
  const before = await figures();
  const { result } = await recallWithRetry([{ delayMs: 200 }, { delayMs: 0, fail: true }]);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.fallback_reason, null);
  assert.deepEqual(await figures(), { failures: before.failures, rescued: before.rescued + 1 });
});

test('a call that fails after the other call already answered is counted as rescued', async () => {
  const before = await figures();
  const { result } = await recallWithRetry([{ delayMs: 250, fail: true }, { delayMs: 0 }]);
  assert.equal(result.mode, 'hybrid');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await figures(), { failures: before.failures, rescued: before.rescued + 1 });
});

test('a failure to record a rescue never breaks a read-only Recall', async () => {
  const { getDb } = await import('../../src/lib/db');
  getDb().exec(`CREATE TRIGGER block_meta BEFORE UPDATE ON settings WHEN NEW.key = 'embedding_meta'
    BEGIN SELECT RAISE(ABORT, 'write refused'); END`);
  try {
    const { result } = await recallWithRetry([{ delayMs: 100, fail: true }, { delayMs: 200 }]);
    assert.equal(result.mode, 'hybrid');
  } finally {
    getDb().exec('DROP TRIGGER block_meta');
  }
});

test('when both calls fail, Recall reports provider_error and nothing counts as rescued', async () => {
  const before = await figures();
  const { result } = await recallWithRetry([{ delayMs: 100, fail: true }, { delayMs: 0, fail: true }]);
  assert.equal(result.mode, 'keyword');
  assert.equal(result.fallback_reason, 'provider_error');
  assert.equal(queryCalls, 2);
  assert.deepEqual(await figures(), { failures: before.failures + 1, rescued: before.rescued });
});

test('when both calls are slow, Recall still answers at the limit and makes only one extra call', async () => {
  const { result, ms } = await recallWithRetry([{ delayMs: 900 }, { delayMs: 900 }]);
  assert.equal(result.fallback_reason, 'timeout');
  assert(ms < 850, 'recall returned at the limit, not at provider speed');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(queryCalls, 2);
});

test('a retry delay of 0 turns the extra call off', async () => {
  process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS = '0';
  process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = '100';
  delayMs = 200;
  const { recallDetailed } = await import('../../src/lib/recall');
  const result = await recallDetailed({ query: 'slow query words', refreshStale: false });
  assert.equal(result.fallback_reason, 'timeout');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(queryCalls, 1);
});

test('both answers of a retried query are reported, each timed from its own call', async () => {
  process.env.CHIBAKO_EMBEDDING_QUERY_RETRY_MS = '50';
  const { embedQuery } = await import('../../src/lib/query-embedding');
  const waits = [200, 0];
  const provider: EmbeddingProvider = {
    id: 'fake', model: 'retry-report', dim: 2,
    embed: async (t) => {
      await new Promise((r) => setTimeout(r, waits.shift()));
      return t.map(() => [1, 0]);
    },
  };
  const answers: number[] = [];
  await embedQuery(provider, 'q', (ms) => answers.push(ms));
  assert.equal(answers.length, 1, 'the extra call answered first');
  assert(answers[0] < 50, 'the extra call is timed from its own start, not the query start');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(answers.length, 2, 'the slow first call still reports its late answer');
  assert(answers[1] >= 190);
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
