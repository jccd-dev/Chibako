import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createClassification } from "../src/features/finance/classifications";
import { GET as report } from "../src/app/api/finance/reports/route";
import { GET as budget, PUT as set } from "../src/app/api/finance/budgets/route";
import { POST as remote } from "../src/app/mcp/route";
const vault = mkdtempSync(join(tmpdir(), "chibako-budget-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const context = { params: Promise.resolve({}) };
function rest(key: string, path: string, body?: object) { return new Request(`https://chibako.test/api/finance/${path}`, { method: body ? "PUT" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
async function rpc(key: string, method: string, params: object) {
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  assert.equal(response.status, 200);
  const body = await response.json(); return body.result ?? { isError: true, content: [{ text: body.error?.message }] };
}
const call = (key: string, name: string, args: object) => rpc(key, "tools/call", { name, arguments: args });
test("reports and budgets have independent scope catalogs and REST/MCP parity, retry and validation", async () => {
  const category = createClassification({ kind: "owner" }, { request_id: "category", kind: "category", type: "expense", name: "Food" }).classification;
  const payload = { request_id: "budget", category_id: category.id, month: "2026-10", amount: "100", mode: "forward", version: 0 };
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:read"], ["finance:write"], ["finance:manage"]]) {
    const { key } = createApiKey(scopes.join(), scopes);
    assert.equal((await report(rest(key, "reports"), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await budget(rest(key, `budgets?category_id=${category.id}&month=2026-10`), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await set(rest(key, "budgets", payload), context)).status, scopes.includes("finance:manage") ? 200 : 403);
    const catalog = await rpc(key, "tools/list", {});
    if (scopes.length === 0) {
      assert.equal(catalog.isError, true);
      assert.match(catalog.content[0].text, /Method not found/);
    }
    const tools: { name: string }[] = catalog.tools ?? [];
    assert.equal(tools.some(tool => tool.name === "get_finance_report"), scopes.includes("finance:read"));
    assert.equal(tools.some(tool => tool.name === "set_finance_budget"), scopes.includes("finance:manage"));
  }
  const { key, id } = createApiKey("Finance", ["finance:read", "finance:manage"]);
  payload.version = 1;
  const saved = await (await set(rest(key, "budgets", payload), context)).json();
  assert.deepEqual((await call(key, "set_finance_budget", payload)).structuredContent, saved);
  assert.equal((await set(rest(key, "budgets", { ...payload, amount: "200" }), context)).status, 409);
  assert.equal((await call(key, "set_finance_budget", { ...payload, amount: "200" })).isError, true);
  const query = { date_from: "2026-10-01", date_to: "2026-10-31", limit: 1 };
  assert.deepEqual((await call(key, "get_finance_report", query)).structuredContent, await (await report(rest(key, "reports?date_from=2026-10-01&date_to=2026-10-31&limit=1"), context)).json());
  assert.deepEqual((await call(key, "get_finance_budget", { category_id: category.id, month: "2026-10" })).structuredContent, await (await budget(rest(key, `budgets?category_id=${category.id}&month=2026-10`), context)).json());
  for (const query of ["limit=101", "offset=-1", "date_from=2026-02-30", "unknown=true", "date_from=2025-01-01&date_to=2026-12-31"]) assert.equal((await report(rest(key, "reports?" + query), context)).status, 400);
  assert.equal((await set(rest(key, "budgets", { ...payload, request_id: "bad", amount: "-1" }), context)).status, 400);
  assert.equal((await set(rest("invalid", "budgets", payload), context)).status, 401);
  const audit = getDb().prepare("SELECT actor_id, before_json, after_json FROM finance_audit WHERE actor_id = ? AND operation = 'budget.set'").all(`api-key:${id}`) as { actor_id: string; before_json: string; after_json: string }[];
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].before_json).version, 1);
  assert.equal(JSON.parse(audit[0].after_json).version, 2);
  assert.equal(JSON.stringify(audit).includes(key), false);
});
