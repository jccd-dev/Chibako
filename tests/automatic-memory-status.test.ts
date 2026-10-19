import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getMemoryStatus } from "../src/features/memory/memory";
import { MemoryError } from "../src/features/memory/types";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import type { ApiKeyPrincipal } from "../src/server/auth/api-key-authorization";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-automatic-memory-status-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

async function rpc(key: string, name: string) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.result;
}

test("memory status requires memory:write and returns only the bounded status contract", () => {
  const principal: ApiKeyPrincipal = { id: "profile-7", scopes: ["memory:write", "notes:read", "schema:read"] };
  assert.deepEqual(getMemoryStatus(principal), {
    contract_version: 1, principal_id: "profile-7", scopes: ["memory:write", "notes:read", "schema:read"],
    enabled: true, area: "Agent Memory",
  });
  assert.throws(() => getMemoryStatus({ ...principal, scopes: ["notes:read", "schema:read"] }),
    (error) => error instanceof MemoryError && error.code === "forbidden");

  const configured = process.env.CHIBAKO_MEMORY_FOLDER;
  delete process.env.CHIBAKO_MEMORY_FOLDER;
  try {
    assert.deepEqual(getMemoryStatus(principal), {
      contract_version: 1, principal_id: "profile-7", scopes: principal.scopes, enabled: false, area: null,
    });
  } finally { process.env.CHIBAKO_MEMORY_FOLDER = configured; }
});

test("remote MCP exposes memory_status to the memory principal without revealing note data", async () => {
  const key = createApiKey("Restricted memory status test", ["memory:write", "notes:read", "schema:read"]);
  const status = await rpc(key.key, "memory_status");
  assert.deepEqual(status.structuredContent, {
    contract_version: 1, principal_id: key.id, scopes: ["memory:write", "notes:read", "schema:read"],
    enabled: true, area: "Agent Memory",
  });
  assert.equal(JSON.stringify(status.structuredContent).includes("content"), false);
  assert.equal(JSON.stringify(status.structuredContent).includes("note_id"), false);
});
