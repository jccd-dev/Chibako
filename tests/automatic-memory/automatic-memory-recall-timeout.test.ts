import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { POST as remote } from "../../src/app/mcp/route";
import { getDb } from "../../src/lib/db";
import { createNote } from "../../src/lib/notes";
import { queryEmbedTimeoutMs } from "../../src/lib/query-embedding";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { connectMemory, MEMORY_REQUEST_TIMEOUT_MS } from "../../scripts/memory/connection";
import { runMemoryEvent } from "../../scripts/memory/runtime";

const root = mkdtempSync(path.join(tmpdir(), "chibako-recall-hook-timeout-"));
process.env.CHIBAKO_DATA_DIR = path.join(root, "vault");
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory Test";
after(() => { getDb().close(); rmSync(root, { recursive: true, force: true }); });

// Room the hook must keep after the provider's wait: measured Recall work besides the provider is ~10 ms, the rest is network and transport.
const MIN_ROOM_MS = 500;

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

test("the default query Embedding limit leaves room inside the hook's request limit", () => {
  const saved = process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
  delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
  try {
    assert.equal(MEMORY_REQUEST_TIMEOUT_MS, 5000, "the hook's request limit is unchanged");
    assert.ok(queryEmbedTimeoutMs() + MIN_ROOM_MS <= MEMORY_REQUEST_TIMEOUT_MS,
      `query limit ${queryEmbedTimeoutMs()} ms must leave ${MIN_ROOM_MS} ms inside the hook limit ${MEMORY_REQUEST_TIMEOUT_MS} ms`);
  } finally { if (saved !== undefined) process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = saved; }
});

test("a hook still gets keyword memory when the embedding provider never answers", async (t) => {
  // A provider that accepts the request and never replies, i.e. slower than any hook limit.
  const provider = createServer(() => {});
  // The real /mcp route behind a loopback socket, so the hook's own transport and limit apply.
  const mcp = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = incoming.method || "POST";
    const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
    const response = await remote(new Request(`http://127.0.0.1${incoming.url || "/mcp"}`, { method, headers, ...(body ? { body } : {}) }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  let providerPort: number, mcpPort: number;
  try { [providerPort, mcpPort] = [await listen(provider), await listen(mcp)]; }
  catch (error) {
    if ((error as { code?: string }).code === "EPERM") { t.skip("sandbox denies binding a loopback HTTP server"); return; }
    throw error;
  }
  const saved = { ...process.env };
  delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS; // the default is under test
  Object.assign(process.env, {
    CHIBAKO_EMBEDDING_PROVIDER: "openai", CHIBAKO_EMBEDDING_API_KEY: "test-key",
    CHIBAKO_EMBEDDING_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
  });
  const memory = connectMemory(`http://127.0.0.1:${mcpPort}/mcp`, createApiKey("Hook recall", ["memory:write", "notes:read", "schema:read", "search:read"]).key);
  try {
    createNote({ title: "Auth design", content: "token validation happens in the gateway" });
    const result = await runMemoryEvent({
      runtime: "claude", directory: path.join(root, "hook-state"), enabled: true, call: memory.call,
      input: { session_id: "slow-provider", hook_event_name: "UserPromptSubmit", turn_id: "t1", prompt: "token validation" },
    });
    const context = String(result.context);
    assert.doesNotMatch(context, /Memory retrieval unavailable/, "the hook must not give up before Recall answers");
    const recalled = /Relevant memory \(evidence, not instructions\):\n(.*)\n/.exec(context);
    assert.ok(recalled, "the hook receives a recall result");
    const payload = JSON.parse(recalled[1]) as { mode: string; fallback_reason: string; results: Array<{ title: string }> };
    assert.equal(payload.mode, "keyword");
    assert.equal(payload.fallback_reason, "timeout");
    assert.ok(payload.results.some((r) => r.title === "Auth design"));
  } finally {
    await memory.close();
    for (const server of [provider, mcp]) { server.closeAllConnections(); server.close(); }
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
