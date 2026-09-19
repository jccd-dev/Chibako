import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DELETE, GET, OPTIONS, POST } from "../src/app/mcp/route";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";

const vault = mkdtempSync(join(tmpdir(), "chibako-mcp-http-test-"));
process.env.CHIBAKO_DATA_DIR = vault;
let readKey = "";

function request(body: unknown, key = readKey, headers: HeadersInit = {}) {
  return new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

before(() => {
  getDb();
  readKey = createApiKey("Remote reader", ["notes:read", "search:read", "schema:read"]).key;
});

after(() => {
  getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

test("remote MCP negotiates and exposes only scoped tools", async () => {
  const initialize = await POST(request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }));
  assert.equal(initialize.status, 200);
  assert.equal((await initialize.json()).result.serverInfo.name, "chibako");

  const listed = await POST(request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  assert.equal(listed.status, 200);
  const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("list_notes"));
  assert.ok(!names.includes("create_note"));
  assert.ok(!names.includes("index_embeddings"));
});

test("remote MCP rejects cookies, foreign origins, large bodies, and unsupported methods", async () => {
  const noBearer = await POST(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { cookie: "chibako_session=owner", "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(noBearer.status, 401);
  assert.equal(noBearer.headers.get("www-authenticate"), "Bearer");

  assert.equal((await POST(request({}, readKey, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await POST(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${readKey}` },
    body: "x".repeat(1024 * 1024 + 1),
  }))).status, 413);

  for (const handler of [GET, DELETE, OPTIONS]) {
    const response = handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  }
});

test("remote MCP enforces failed-auth and authenticated request limits", async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await POST(request({}, "unknown", { "X-Chibako-Client-IP": "failed-auth-test" }));
    assert.equal(response.status, 401);
  }
  const failedLimited = await POST(request({}, "unknown", { "X-Chibako-Client-IP": "failed-auth-test" }));
  assert.equal(failedLimited.status, 429);
  assert.equal(failedLimited.headers.get("retry-after"), "60");

  const rateKey = createApiKey("Rate test", ["notes:read"]).key;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await POST(new Request("https://chibako.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${rateKey}` },
      body: "{",
    }));
    assert.equal(response.status, 400);
  }
  const authenticatedLimited = await POST(request({}, rateKey));
  assert.equal(authenticatedLimited.status, 429);
  assert.equal(authenticatedLimited.headers.get("retry-after"), "60");
});
