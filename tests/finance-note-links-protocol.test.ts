import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createNote, getNote } from "../src/lib/notes";
import { createAccount } from "../src/features/finance/accounts";
import { postTransaction } from "../src/features/finance/activity";
import { GET as links, PUT as setLinks } from "../src/app/api/finance/activity/[id]/notes/route";
import { GET as choices } from "../src/app/api/finance/notes/route";
import { GET as detail } from "../src/app/api/finance/activity/[id]/route";
import { POST as post } from "../src/app/api/finance/activity/route";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-note-links-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function rest(key: string, method: string, body?: object, query = "") {
  return new Request(`https://chibako.test/api/finance/activity/id/notes${query}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.result ?? { isError: true, content: [{ text: body.error?.message }] };
}
function fixture() {
  const note = createNote({ title: randomUUID(), content: "Private Note content" });
  const account = createAccount({ kind: "owner" }, { request_id: randomUUID(), name: randomUUID(), kind: "money", currency: "PHP", opening_balance: "100" }).account;
  const transaction = postTransaction({ kind: "owner" }, { request_id: randomUUID(), account_id: account.id, amount: "1", transaction_date: "2026-10-01", note_ids: [note.id] }).transaction;
  return { account, note, transaction, context: { params: Promise.resolve({ id: transaction.id }) } };
}

test("REST and remote MCP independently require finance scope AND notes:read; Note edits still need notes:write", async () => {
  const { note, transaction, context } = fixture();
  const initialNote = getNote(note.id);
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:read"], ["finance:write"], ["finance:manage", "notes:read"], ["finance:read", "notes:write"], ["finance:read", "notes:read"], ["finance:write", "notes:read"], ["finance:read", "finance:write", "notes:read"]]) {
    const { key } = createApiKey(scopes.join(), scopes);
    const canRead = scopes.includes("finance:read") && scopes.includes("notes:read");
    const canWrite = scopes.includes("finance:write") && scopes.includes("notes:read");
    const version = (getDb().prepare("SELECT version FROM finance_transactions WHERE id = ?").get(transaction.id) as { version: number }).version;
    const payload = { request_id: randomUUID(), version, note_ids: [note.id] };
    const read = await links(rest(key, "GET"), context);
    assert.equal(read.status, canRead ? 200 : 403, scopes.join());
    assert.equal((await choices(rest(key, "GET"), context)).status, canRead ? 200 : 403);
    const mcpRead = await rpc(key, "get_finance_note_links", { id: transaction.id });
    if (canRead) {
      assert.deepEqual(mcpRead.structuredContent, await read.json());
      assert.equal(mcpRead.structuredContent.notes[0].title, note.title);
      assert.equal("content" in mcpRead.structuredContent.notes[0], false);
    } else assert.equal(mcpRead.isError, true);
    const written = await setLinks(rest(key, "PUT", payload), context);
    assert.equal(written.status, canWrite ? 200 : 403, scopes.join());
    const mcpWritten = await rpc(key, "set_finance_note_links", { id: transaction.id, ...payload });
    if (canWrite) assert.deepEqual(mcpWritten.structuredContent, await written.json());
    else assert.equal(mcpWritten.isError, true);
    if (scopes.includes("finance:read")) {
      const financial = await (await detail(rest(key, "GET", undefined, "?include_details=true"), context)).json();
      assert.equal(JSON.stringify(financial).includes(note.title), false);
      assert.equal(JSON.stringify(financial).includes(note.content), false);
    }
    if (canWrite) {
      assert.equal((await rpc(key, "update_note", { id: note.id, content: "Unauthorized edit" })).isError, true);
    }
  }
  assert.deepEqual(getNote(note.id), initialNote);
  assert.equal((await setLinks(rest("invalid", "PUT", { request_id: randomUUID(), version: 1, note_ids: [] }), context)).status, 401);
});

test("protocol retries, stale edits, removal and bounded choices preserve contracts and keyed attribution", async () => {
  const { account, note, transaction, context } = fixture();
  const { key, id } = createApiKey("Both", ["finance:read", "finance:write", "notes:read"]);
  const payload = { request_id: randomUUID(), version: 1, note_ids: [] };
  const response = await setLinks(rest(key, "PUT", payload), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.deepEqual((await rpc(key, "set_finance_note_links", { id: transaction.id, ...payload })).structuredContent, result);
  assert.equal(result.balances[0].balance_cents, 9900);
  assert.equal((await setLinks(rest(key, "PUT", { ...payload, note_ids: [note.id] }), context)).status, 409);
  assert.match((await rpc(key, "set_finance_note_links", { id: transaction.id, ...payload, note_ids: [note.id] })).content[0].text, /request_conflict/);
  const stale = { ...payload, request_id: randomUUID() };
  assert.equal((await setLinks(rest(key, "PUT", stale), context)).status, 409);
  assert.match((await rpc(key, "set_finance_note_links", { id: transaction.id, ...stale })).content[0].text, /version_conflict/);
  assert.deepEqual((await (await links(rest(key, "GET"), context)).json()).notes, []);
  const query = { q: note.title.slice(0, 8), limit: 1, offset: 0 };
  const page = await (await choices(rest(key, "GET", undefined, `?${new URLSearchParams({ q: query.q, limit: "1", offset: "0" })}`), context)).json();
  assert.deepEqual((await rpc(key, "list_finance_note_choices", query)).structuredContent, page);
  assert.deepEqual(page.notes, [{ id: note.id, title: note.title }]);
  assert.equal((await choices(rest(key, "GET", undefined, "?limit=101"), context)).status, 400);
  const writer = createApiKey("No Notes", ["finance:write"]);
  const postInput = { request_id: randomUUID(), account_id: account.id, amount: "1", transaction_date: "2026-10-01", note_ids: [note.id] };
  assert.equal((await post(rest(writer.key, "POST", postInput), context)).status, 403);
  assert.match((await rpc(writer.key, "post_finance_transaction", postInput)).content[0].text, /forbidden/);
  const audit = getDb().prepare("SELECT actor_id, before_json, after_json FROM finance_audit WHERE request_id = ?").get(payload.request_id) as { actor_id: string };
  assert.equal(audit.actor_id, `api-key:${id}`);
  assert.equal(JSON.stringify(audit).includes(key), false);
});
