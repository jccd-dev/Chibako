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

  const http = await (await restRecall(rest(key, 'recall?q=token%20validation') as never, context)).json();
  const mcp = (await rpc(key, 'recall', { query: 'token validation' })).structuredContent;
  assert.equal(http.mode, 'keyword');
  assert.equal(http.fallback_reason, 'disabled');
  assert.equal(mcp.mode, http.mode);
  assert.equal(mcp.fallback_reason, http.fallback_reason);
  assert.equal(mcp.count, http.count);
  assert.deepEqual(mcp.results, http.results, 'result fields and order are unchanged');

  const status = (await (await restEmbeddings(rest(key, 'embeddings') as never, context)).json()).status;
  assert.deepEqual((await rpc(key, 'embedding_status', {})).structuredContent, status);
  assert.deepEqual(status.query_failures, { timeout: 0, provider_error: 0 });
});

test('a provider error is reported the same way through REST and MCP and counted in both statuses', async () => {
  process.env.CHIBAKO_EMBEDDING_PROVIDER = 'openai';
  process.env.CHIBAKO_EMBEDDING_API_KEY = 'test-key';
  process.env.CHIBAKO_EMBEDDING_BASE_URL = 'http://127.0.0.1:9/v1';
  const { key } = createApiKey('reader2', ['notes:read', 'search:read']);
  const http = await (await restRecall(rest(key, 'recall?q=token%20validation') as never, context)).json();
  const mcp = (await rpc(key, 'recall', { query: 'token validation' })).structuredContent;
  assert.equal(http.fallback_reason, 'provider_error');
  assert.equal(mcp.fallback_reason, 'provider_error');
  assert.equal(http.mode, 'keyword');
  assert.equal(mcp.mode, 'keyword');
  const status = (await (await restEmbeddings(rest(key, 'embeddings') as never, context)).json()).status;
  assert.equal(status.query_failures.provider_error, 2);
  assert.deepEqual((await rpc(key, 'embedding_status', {})).structuredContent, status);
});
