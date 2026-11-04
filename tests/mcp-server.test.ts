import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFolder, folderTree } from "../src/features/organization/folders";
import { createMcpServer } from "../src/mcp/create-server";
import { getDb } from "../src/lib/db";
import { createNote } from "../src/lib/notes";

const vault = mkdtempSync(join(tmpdir(), "chibako-mcp-server-test-"));
process.env.CHIBAKO_DATA_DIR = vault;

async function connect(scopes: string[] | null, exposure: "local" | "remote") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ scopes, exposure });
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

before(() => getDb());
after(() => {
  getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

test("remote catalogs are scope-filtered and exclude embedding maintenance", async () => {
  createNote({ title: "Graph B", folder: "Pagination", content: "target" });
  createNote({ title: "Graph A", folder: "Pagination", content: "[[Graph B]]" });
  const readOnly = await connect(["notes:read", "search:read", "schema:read"], "remote");
  const tools = await readOnly.client.listTools();
  const names = tools.tools.map((tool) => tool.name);

  assert.ok(names.includes("list_notes"));
  assert.ok(names.includes("get_knowledge_schema"));
  assert.ok(names.includes("embedding_status"));
  assert.ok(!names.includes("create_note"));
  assert.ok(!names.includes("purge_note"));
  assert.ok(!names.includes("index_embeddings"));
  assert.equal(tools.tools.find((tool) => tool.name === "list_notes")?.annotations?.readOnlyHint, true);
  const graph = await readOnly.client.callTool({ name: "get_graph", arguments: { folder: "Pagination", limit: 1, offset: 0 } });
  assert.deepEqual(graph.structuredContent, {
    node_count: 1,
    link_count: 1,
    notes: [{ id: (graph.structuredContent as { notes: Array<{ id: string }> }).notes[0].id, title: "Graph A", folder: "Pagination", kind: "note" }],
    links: [{ source: "Graph A", target: "Graph B" }],
    total_nodes: 2,
  });

  await readOnly.client.close();
  await readOnly.server.close();
});

test("purge requires its own scope and local MCP retains embedding indexing", async () => {
  const writeOnly = await connect(["notes:write"], "remote");
  const writeNames = (await writeOnly.client.listTools()).tools.map((tool) => tool.name);
  assert.ok(writeNames.includes("create_note"));
  assert.ok(!writeNames.includes("purge_note"));
  assert.equal((await writeOnly.client.listTools()).tools.find((tool) => tool.name === "delete_note")?.annotations?.destructiveHint, false);
  const created = await writeOnly.client.callTool({ name: "create_note", arguments: { title: "Remote", content: "# Remote" } });
  assert.equal(created.isError, undefined);
  assert.deepEqual(JSON.parse((created.content as Array<{ text: string }>)[0].text), created.structuredContent);
  await writeOnly.client.close();
  await writeOnly.server.close();

  const purge = await connect(["notes:purge"], "remote");
  const purgeTool = (await purge.client.listTools()).tools.find((tool) => tool.name === "purge_note");
  assert.equal(purgeTool?.annotations?.destructiveHint, true);
  await purge.client.close();
  await purge.server.close();

  const local = await connect(null, "local");
  assert.ok((await local.client.listTools()).tools.some((tool) => tool.name === "index_embeddings"));
  await local.client.close();
  await local.server.close();
});

test("delete_folder needs notes:write and refuses folders with live notes", async () => {
  const reader = await connect(["notes:read"], "remote");
  assert.ok(!(await reader.client.listTools()).tools.some((tool) => tool.name === "delete_folder"));
  await reader.client.close();
  await reader.server.close();

  const writer = await connect(["notes:write"], "remote");
  await writer.client.callTool({ name: "create_note", arguments: { title: "Folder resident", folder: "Tool/Busy", content: "kept" } });
  const refused = await writer.client.callTool({ name: "delete_folder", arguments: { path: "Tool/Busy" } });
  assert.equal(refused.isError, true);
  assert.match((refused.content as Array<{ text: string }>)[0].text, /live notes/);

  createFolder("Tool/Empty");
  const deleted = await writer.client.callTool({ name: "delete_folder", arguments: { path: "Tool/Empty" } });
  assert.equal(deleted.isError, undefined);
  assert.deepEqual(deleted.structuredContent, { deleted: "Tool/Empty", parent: "Tool" });
  assert.ok(!folderTree().includes("Tool/Empty"));
  await writer.client.close();
  await writer.server.close();
});
