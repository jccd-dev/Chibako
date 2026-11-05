import { inRequestScope } from "../recall/request-scope";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as restSave, GET as restList } from "../../src/app/api/observations/route";
import { POST as remote } from "../../src/app/mcp/route";
import { getDb } from "../../src/lib/db";
import { createNote, getNote, getNoteByPath, updateNote } from "../../src/lib/notes";
import { recall } from "../../src/lib/recall";
import { createApiKey } from "../../src/server/auth/api-key-authorization";

const vault = mkdtempSync(join(tmpdir(), "chibako-fact-notes-"));
process.env.CHIBAKO_DATA_DIR = vault;
delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
delete process.env.CHIBAKO_MEMORY_FOLDER;
const context = { params: Promise.resolve({}) };
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const rest = (key: string, body: object) => inRequestScope(() => restSave(new NextRequest("https://chibako.test/api/observations", {
  method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body),
}) as never, context));
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.result ?? { isError: true, content: [{ text: body.error?.message }] };
}
const counts = () => ({
  notes: (getDb().prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n,
  observations: (getDb().prepare("SELECT COUNT(*) AS n FROM observations").get() as { n: number }).n,
  records: (getDb().prepare("SELECT COUNT(*) AS n FROM memory_records").get() as { n: number }).n,
});

test("with no memory folder, memory_save keeps writing the legacy observation row on both transports", async () => {
  const { key } = createApiKey("writer", ["notes:write", "notes:read"]);
  const mcp = (await rpc(key, "memory_save", { content: "legacy via mcp" })).structuredContent;
  const http = (await (await rest(key, { content: "legacy via rest" })).json()).observation;
  for (const receipt of [mcp, http]) assert.deepEqual(Object.keys(receipt).sort(), ["created_at", "id", "note_id", "saved"]);
  assert.deepEqual(counts(), { notes: 0, observations: 2, records: 0 });
  const listed = await (await inRequestScope(() => restList(new NextRequest("https://chibako.test/api/observations", { headers: { authorization: `Bearer ${key}` } }) as never, context))).json();
  assert.equal(listed.count, 2);
  assert.equal((await rpc(key, "delete_observation", { id: mcp.id })).isError, undefined);
  assert.equal((await rpc(key, "list_observations", {})).structuredContent.count, 1);
});

test("memory_save creates a Fact note that Recall finds, REST and MCP match, and retries add no second Note", async () => {
  process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
  try {
    const { key } = createApiKey("writer", ["notes:write"]);
    const related = createNote({ title: "Billing design", folder: "Projects", content: "billing" });
    const before = counts();

    const saved = (await rpc(key, "memory_save", { content: "Invoices are issued on the last business day.\nDetails follow.", note_id: related.id, project: "chibako", source: "claude" })).structuredContent;
    assert.deepEqual(Object.keys(saved).sort(), ["created_at", "id", "note_id", "saved"]);
    assert.equal(saved.note_id, related.id);
    const fact = getNote(saved.id)!;
    assert.equal(fact.folder, "Agent Memory/chibako");
    assert.equal(fact.title, "Invoices are issued on the last business day.");
    assert.equal(fact.kind, "wiki");
    assert.match(fact.content, /Related: \[\[Projects\/Billing design\]\]/);
    assert.match(fact.content, /Source: claude/);
    assert.equal((getDb().prepare("SELECT role FROM memory_records WHERE note_id = ?").get(fact.id) as { role: string }).role, "wiki");
    assert.deepEqual(counts(), { ...before, notes: before.notes + 1, records: before.records + 1 });

    const found = await recall({ query: "invoices business day" });
    assert.ok(found.some((item) => item.id === fact.id), "Recall finds the Fact note");

    // Retry on either transport returns the same Note and writes nothing.
    const again = (await rpc(key, "memory_save", { content: "Invoices are issued on the last business day.\nDetails follow.", note_id: related.id, project: "chibako", source: "other" })).structuredContent;
    assert.equal(again.id, fact.id);
    const viaRest = (await (await rest(key, { content: "Invoices are issued on the last business day.\nDetails follow.", note_id: related.id, project: "chibako" })).json()).observation;
    assert.equal(viaRest.id, fact.id);
    assert.equal(counts().notes, before.notes + 1);

    // Same derived title, different fact: a numbered title, never an error. No project files at the area root.
    const second = (await (await rest(key, { content: "Invoices are issued on the last business day.\nA different second fact.", project: "chibako" })).json()).observation;
    assert.equal(getNote(second.id)!.title, "Invoices are issued on the last business day. (2)");
    assert.equal(second.note_id, null);
    const rootFact = (await rpc(key, "memory_save", { content: "# Cross project rule", title: "Prefer small PRs" })).structuredContent;
    assert.equal(getNote(rootFact.id)!.folder, "Agent Memory");
    assert.equal(getNote(rootFact.id)!.title, "Prefer small PRs");
    // An explicit title that already exists is refused, not renamed.
    const clash = await rpc(key, "memory_save", { content: "another", title: "Prefer small PRs" });
    assert.equal(clash.isError, true);
  } finally {
    delete process.env.CHIBAKO_MEMORY_FOLDER;
  }
});

test("denied and malformed saves write nothing, and an outdated fact can be archived with a link to its replacement", async () => {
  process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
  try {
    const reader = createApiKey("reader", ["notes:read", "memory:write"]);
    const { key } = createApiKey("writer", ["notes:write"]);
    const pipeNote = createNote({ title: "Billing|private", folder: "Projects", content: "pipe" });
    const before = counts();
    assert.equal((await rpc(reader.key, "memory_save", { content: "x" })).isError, true);
    assert.equal((await rest(reader.key, { content: "x" })).status, 403);
    for (const body of [
      { content: "x", project: "Bad/Project" }, { content: "x", title: "a/b" }, { content: "x", title: "a|b" },
      { content: "x", note_id: "missing" }, { content: "   " }, { content: "x", extra: 1 }, { content: "y".repeat(200_001) }, { content: "x", note_id: pipeNote.id },
    ]) {
      assert.equal((await rpc(key, "memory_save", body)).isError, true, JSON.stringify(body).slice(0, 60));
      assert.ok((await rest(key, body)).status >= 400);
    }
    assert.deepEqual(counts(), before);

    // The legacy 200k range still saves as a Fact note, past the checkpoint 64k cap.
    const big = (await rpc(key, "memory_save", { content: "Big fact. " + "y".repeat(100_000), source: "claude" })).structuredContent;
    assert.ok(getNote(big.id)!.content.length > 100_000);

    const oldFact = (await rpc(key, "memory_save", { content: "Deploys run on Fridays.", title: "Deploy day" })).structuredContent;
    const replacement = (await rpc(key, "memory_save", { content: "Deploys never run on Fridays.", title: "Deploy day v2" })).structuredContent;
    const note = getNote(oldFact.id)!;
    updateNote(note.id, { content: `---\nstatus: archived\n---\n${note.content}\n\nReplaced by [[Agent Memory/Deploy day v2]]` });
    assert.equal(getNote(oldFact.id)!.properties.status, "archived");
    const hits = await recall({ query: "deploys fridays" });
    const ranks = hits.map((item) => item.id);
    assert.ok(ranks.indexOf(replacement.id) < ranks.indexOf(oldFact.id), "the archived fact ranks below its replacement");
    assert.ok(getNoteByPath("Agent Memory", "Deploy day v2"));
  } finally {
    delete process.env.CHIBAKO_MEMORY_FOLDER;
  }
});
