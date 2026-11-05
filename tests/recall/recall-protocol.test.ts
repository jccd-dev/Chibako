import { inRequestScope } from './request-scope';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { NextRequest } from 'next/server';
import { getDb } from '../../src/lib/db';
import { createNote } from '../../src/lib/notes';
import { createApiKey } from '../../src/server/auth/api-key-authorization';
import { GET as restRecall } from '../../src/app/api/recall/route';
import { GET as restEmbeddings } from '../../src/app/api/embeddings/route';
import { POST as remote } from '../../src/app/mcp/route';

const vault = mkdtempSync(join(tmpdir(), 'chibako-recall-protocol-'));
process.env.CHIBAKO_DATA_DIR = vault;
delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
const context = { params: Promise.resolve({}) };
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

// withAuthAny reads the session cookie even for Bearer keys, so REST handlers need a request scope.
const restGet = (handler: typeof restRecall, request: NextRequest) => inRequestScope(() => handler(request as never, context));

function rest(key: string, path: string) {
  return new NextRequest(`https://chibako.test/api/${path}`, { headers: { authorization: `Bearer ${key}` } });
}
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request('https://chibako.test/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

test('REST and MCP Recall return the same mode, fallback reason and results, and embedding status matches', async () => {
  createNote({ title: 'Parity', content: 'token validation happens here' });
  const { key } = createApiKey('reader', ['notes:read', 'search:read']);

  const http = await (await restGet(restRecall, rest(key, 'recall?q=token%20validation'))).json();
  const mcp = (await rpc(key, 'recall', { query: 'token validation' })).structuredContent;
  assert.equal(http.mode, 'keyword');
  assert.equal(http.fallback_reason, 'disabled');
  assert.equal(mcp.mode, http.mode);
  assert.equal(mcp.fallback_reason, http.fallback_reason);
  assert.equal(mcp.count, http.count);
  assert.deepEqual(mcp.results, http.results, 'result fields and order are unchanged');

  const status = (await (await restGet(restEmbeddings, rest(key, 'embeddings'))).json()).status;
  assert.deepEqual((await rpc(key, 'embedding_status', {})).structuredContent, status);
  assert.deepEqual(status.query_failures, { timeout: 0, provider_error: 0 });
  for (const field of ['last_repair_at', 'repair_indexed', 'repair_remaining', 'query_failures_rescued']) assert.ok(field in status, `${field} is in the shared status`);
});

test('a provider error is reported the same way through REST and MCP and counted in both statuses', async () => {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
  process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';
  process.env.CHIBAKO_EMBEDDING_BASE_URL = 'http://127.0.0.1:9/v1';
  const { key } = createApiKey('reader2', ['notes:read', 'search:read']);
  const http = await (await restGet(restRecall, rest(key, 'recall?q=token%20validation'))).json();
  const mcp = (await rpc(key, 'recall', { query: 'token validation' })).structuredContent;
  assert.equal(http.fallback_reason, 'provider_error');
  assert.equal(mcp.fallback_reason, 'provider_error');
  assert.equal(http.mode, 'keyword');
  assert.equal(mcp.mode, 'keyword');
  const status = (await (await restGet(restEmbeddings, rest(key, 'embeddings'))).json()).status;
  assert.equal(status.query_failures.provider_error, 2);
  assert.deepEqual((await rpc(key, 'embedding_status', {})).structuredContent, status);
});

test('REST and MCP Recall items carry the same status', async () => {
  createNote({ title: 'Retired plan', content: 'osprey migration plan', properties: { status: 'archived' } });
  createNote({ title: 'Live plan', content: 'osprey migration plan' });
  const { key } = createApiKey('reader3', ['notes:read', 'search:read']);
  const http = await (await restGet(restRecall, rest(key, 'recall?q=osprey'))).json();
  const mcp = (await rpc(key, 'recall', { query: 'osprey' })).structuredContent;
  assert.deepEqual(mcp.results, http.results);
  const status = Object.fromEntries(http.results.map((r: { title: string; status: string | null }) => [r.title, r.status]));
  assert.deepEqual(status, { 'Live plan': null, 'Retired plan': 'archived' });
});

test('the project hint reorders Recall the same way through REST and MCP', async () => {
  createNote({ title: 'Rollout plan', folder: 'Agent Memory/zeta', content: 'rollout plan for hint parity' });
  createNote({ title: 'Rollout plan', folder: 'Agent Memory/atlas', content: 'rollout plan for hint parity' });
  const { key } = createApiKey('reader3', ['notes:read', 'search:read']);
  const http = await (await restGet(restRecall, rest(key, 'recall?q=rollout%20plan%20hint%20parity&project=atlas'))).json();
  const mcp = (await rpc(key, 'recall', { query: 'rollout plan hint parity', project: 'atlas' })).structuredContent;
  assert.equal(http.results[0].folder, 'Agent Memory/atlas');
  assert.deepEqual(mcp.results, http.results);
});

test('a malformed project hint is rejected the same way through REST and MCP', async () => {
  const { key } = createApiKey('reader4', ['notes:read', 'search:read']);
  for (const project of ['Bad Project', '../escape', 'a'.repeat(65), '']) {
    const http = await restGet(restRecall, rest(key, `recall?q=rollout&project=${encodeURIComponent(project)}`));
    assert.equal(http.status, 400, `REST accepted ${JSON.stringify(project)}`);
    const mcp = await rpc(key, 'recall', { query: 'rollout', project });
    assert.equal(mcp.isError, true, `MCP accepted ${JSON.stringify(project)}`);
  }
  for (const project of ['atlas', 'workstation', 'my-repo.v2_x']) {
    assert.equal((await restGet(restRecall, rest(key, `recall?q=rollout&project=${project}`))).status, 200);
    assert.notEqual((await rpc(key, 'recall', { query: 'rollout', project })).isError, true);
  }
});

test('query Embedding latency is the same through REST and MCP', async () => {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'fake';
  try {
    const { key } = createApiKey('latency reader', ['notes:read', 'search:read']);
    await rpc(key, 'recall', { query: 'latency parity question' });
    const status = (await (await restGet(restEmbeddings, rest(key, 'embeddings'))).json()).status;
    assert.equal(status.query_latency.samples, 1);
    assert.deepEqual((await rpc(key, 'embedding_status', {})).structuredContent.query_latency, status.query_latency);
  } finally {
    delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
  }
});
