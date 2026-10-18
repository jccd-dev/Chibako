import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { GET } from "../src/app/api/finance/planning/route";
import { createAccount } from "../src/features/finance/accounts";
import { createPlan } from "../src/features/finance/planning";
import { listPlanning } from "../src/features/finance/planning-list";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { getDb } from "../src/lib/db";

const vault = mkdtempSync(join(tmpdir(), "chibako-planning-list-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const context = { params: Promise.resolve({}) };
const request = (key: string, query = "") => new Request(`https://chibako.test/api/finance/planning${query}`, { headers: { authorization: `Bearer ${key}` } });

test("grouped Planning REST authorizes read access, validates queries and returns capability pagination without writes", async () => {
  const cash = createAccount({ kind: "owner" }, { request_id: randomUUID(), name: "Planning REST fixture", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  createPlan({ kind: "owner" }, { request_id: randomUUID(), account_id: cash.id, amount: "10", due_date: "2026-02-15" });
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:manage"], ["finance:write"], ["finance:read"]]) {
    const { key } = createApiKey("Planning REST scope fixture", scopes);
    const response = await GET(request(key), context);
    assert.equal(response.status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (response.status === 403) assert.equal(JSON.stringify(await response.json()).includes(cash.name), false);
  }
  const { key } = createApiKey("Planning REST reader fixture", ["finance:read"]);
  const financeState = () => getDb().prepare(`SELECT
    (SELECT COUNT(*) FROM finance_plans) AS plans, (SELECT COUNT(*) FROM finance_schedules) AS schedules,
    (SELECT COUNT(*) FROM finance_transactions) AS transactions, (SELECT COUNT(*) FROM finance_audit) AS audits,
    (SELECT COUNT(*) FROM finance_requests) AS requests`).get();
  const before = financeState();
  const response = await GET(request(key, "?filter=attention&as_of=2026-02-15&limit=1&offset=0"), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), listPlanning({ kind: "owner" }, { filter: "attention", as_of: "2026-02-15", limit: 1, offset: 0 }));
  for (const query of ["?filter=pending", "?as_of=2026-02-30", "?limit=101", "?limit=", "?offset=-1", "?unknown=true"])
    assert.equal((await GET(request(key, query), context)).status, 400);
  assert.equal((await GET(request("invalid"), context)).status, 401);
  assert.deepEqual(financeState(), before);
});
