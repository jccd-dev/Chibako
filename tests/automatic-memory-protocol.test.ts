import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { POST as postMemory, GET as getMemory } from "../src/app/api/memory/route";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-automatic-memory-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function rest(key: string, method: "GET" | "POST", body?: object, query = "") {
  return new Request(`https://chibako.test/api/memory${query}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function rpc(key: string, method: "tools/call" | "tools/list", name?: string, args?: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: method === "tools/list" ? {} : { name, arguments: args } }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.result ?? { isError: true, content: [{ text: body.error?.message }] };
}

test("REST and remote MCP share memory data, receipts, validation, and tool scope", async () => {
  const readOnly = createApiKey("Read only", ["notes:read"]);
  const writeOnly = createApiKey("Memory write", ["memory:write"]);
  const wildcard = createApiKey("Wildcard", ["*"]);
  const full = createApiKey("Memory agent", ["memory:write", "notes:read"]);
  const input = {
    request_id: randomUUID(), role: "wiki", subject: "protocol", session_id: "run-rest-mcp",
    title: "Protocol memory", content: "Shared across REST and MCP", expected_revision: null,
  };

  for (const { label, key, canWrite, canRead } of [
    { label: "read-only", key: readOnly.key, canWrite: false, canRead: false },
    { label: "write-only", key: writeOnly.key, canWrite: true, canRead: false },
    { label: "wildcard", key: wildcard.key, canWrite: false, canRead: false },
    { label: "full", key: full.key, canWrite: true, canRead: true },
  ]) {
    const scopedInput = { ...input, subject: `scope-${label}`, session_id: `scope-${label}`, title: `Scope ${label}`, request_id: randomUUID() };
    const tools = (await rpc(key, "tools/list")).tools as Array<{ name: string; annotations?: object }>;
    assert.equal(tools.some((tool) => tool.name === "memory_write"), canWrite);
    assert.equal(tools.some((tool) => tool.name === "memory_read"), canRead);
    const restWrite = await postMemory(rest(key, "POST", scopedInput));
    assert.equal(restWrite.status, canWrite ? 200 : 403);
    const mcpWrite = await rpc(key, "tools/call", "memory_write", { ...scopedInput, subject: `${scopedInput.subject}-mcp`, title: `${scopedInput.title} MCP`, request_id: randomUUID() });
    assert.equal(Boolean(mcpWrite.isError), !canWrite);
    if (!canWrite) assert.match(mcpWrite.content[0].text, /Tool memory_write not found/);
    const query = new URLSearchParams({ role: "session", subject: scopedInput.subject, session_id: scopedInput.session_id });
    assert.equal((await getMemory(rest(key, "GET", undefined, `?${query}`))).status, canRead ? 200 : 403);
  }

  const written = await postMemory(rest(full.key, "POST", input));
  assert.equal(written.status, 200);
  assert.equal(written.headers.get("cache-control"), "no-store");
  const receipt = await written.json();
  assert.deepEqual((await rpc(full.key, "tools/call", "memory_write", input)).structuredContent, receipt);
  const query = new URLSearchParams({ role: "wiki", subject: "protocol", session_id: input.session_id });
  const read = await getMemory(rest(full.key, "GET", undefined, `?${query}`));
  assert.equal(read.headers.get("cache-control"), "no-store");
  const data = await read.json();
  assert.deepEqual((await rpc(full.key, "tools/call", "memory_read", { role: "wiki", subject: "protocol", session_id: input.session_id })).structuredContent, data);
  const invalid = { ...input, request_id: randomUUID(), expected_revision: "stale" };
  assert.equal((await postMemory(rest(full.key, "POST", invalid))).status, 400);
  assert.match((await rpc(full.key, "tools/call", "memory_write", invalid)).content[0].text, /Input validation error/);
});
