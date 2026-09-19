import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const vault = mkdtempSync(join(tmpdir(), "chibako-mcp-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist/mcp/server.mjs")],
    env: { ...getDefaultEnvironment(), CHIBAKO_DATA_DIR: vault },
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-smoke", version: "1" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "list_notes"));
    assert.ok(tools.tools.some((tool) => tool.name === "index_embeddings"));
    const result = await client.callTool({ name: "list_notes", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { count: 0, notes: [] });
  } finally {
    await client.close();
    rmSync(vault, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
