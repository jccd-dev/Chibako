import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { createAccount, getAccount, updateAccount } from "../../src/features/finance/accounts";
import { interestCalendarDate } from "../../src/features/finance/interest-calculation";
import { getInterestProcessingStatus, processAutomaticInterest } from "../../src/features/finance/interest-processing";
import { POST as create } from "../../src/app/api/finance/accounts/route";
import { GET as read, PATCH as update } from "../../src/app/api/finance/accounts/[id]/route";
import { GET as status } from "../../src/app/api/finance/accounts/[id]/interest/route";
import { POST as remote } from "../../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-TEST-interest-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner = { kind: "owner" } as const;
const context = { params: Promise.resolve({}) };
const opening = { name: "TEST savings", kind: "money", currency: "PHP", opening_balance: "1000" };
const today = interestCalendarDate(new Date());
const at = (day: string) => new Date(`${day}T00:00:00+08:00`);
let requests = 0;
const requestId = () => `TEST-${++requests}`;

beforeEach(() => {
  getDb().exec(`DELETE FROM finance_interest_cursors; DELETE FROM finance_interest_adjustments; DELETE FROM finance_interest_periods;
    DELETE FROM finance_interest_configurations; DELETE FROM finance_interest_state; DELETE FROM finance_transactions;
    DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_accounts;`);
});
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const headers = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });
const restCreate = (key: string, body: object) => create(new Request("https://chibako.test/api/finance/accounts", { method: "POST", headers: headers(key), body: JSON.stringify(body) }), context);
const restPatch = (key: string, id: string, body: object) => update(new Request(`https://chibako.test/api/finance/accounts/${id}`, { method: "PATCH", headers: headers(key), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
async function tool(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST", headers: { ...headers(key), accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  return (await response.json()).result;
}
const configurations = () => getDb().prepare("SELECT start_date,end_date,annual_rate_scaled,tax_scaled,frequency FROM finance_interest_configurations ORDER BY start_date").all();
function enabledSince(day: string, interest: object = { annual_rate: "3.65" }) {
  const account = createAccount(owner, { ...opening, request_id: requestId(), interest }).account;
  getDb().prepare("UPDATE finance_accounts SET created_at=? WHERE id=?").run(at(day).getTime() / 1000, account.id);
  getDb().prepare("UPDATE finance_interest_configurations SET start_date=? WHERE account_id=?").run(day, account.id);
  return account;
}

test("REST and MCP share interest settings, status, defaults and validation", async () => {
  const { key } = createApiKey("TEST interest", ["finance:read", "finance:write", "finance:manage"]);
  const restCreated = (await (await restCreate(key, { ...opening, request_id: "rest", interest: { annual_rate: "3.5" } })).json()).account;
  const mcpCreated = (await tool(key, "create_finance_account", { ...opening, request_id: "mcp", interest: { annual_rate: "3.5" } })).structuredContent.account;
  assert.deepEqual(restCreated.interest, { annual_rate: "3.5", withholding_tax: "20", frequency: "monthly", start_date: today });
  assert.deepEqual(mcpCreated.interest, restCreated.interest);

  const edit = { version: 1, interest: { annual_rate: "4.25", frequency: "daily", withholding_tax: "0" } };
  const restEdited = (await (await restPatch(key, restCreated.id, { ...edit, request_id: "rest-edit" })).json()).account;
  const mcpEdited = (await tool(key, "update_finance_account", { ...edit, id: mcpCreated.id, request_id: "mcp-edit" })).structuredContent.account;
  assert.deepEqual(mcpEdited.interest, restEdited.interest);
  assert.deepEqual((await (await read(new Request("https://chibako.test/x", { headers: headers(key) }), { params: Promise.resolve({ id: restCreated.id }) })).json()).account.interest, restEdited.interest);

  const restStatus = await (await status(new Request("https://chibako.test/x", { headers: headers(key) }), { params: Promise.resolve({ id: restCreated.id }) })).json();
  assert.deepEqual((await tool(key, "get_finance_account_interest", { id: restCreated.id })).structuredContent, restStatus);
  assert.equal(restStatus.accrued_cents, 0);

  const before = configurations();
  for (const interest of [{ annual_rate: "-1" }, { annual_rate: "1.23456" }, { annual_rate: "abc" }, { annual_rate: "1", withholding_tax: "100.01" }, { annual_rate: "1", frequency: "weekly" }, { annual_rate: "1", extra: true }, {}]) {
    assert.equal((await restPatch(key, restCreated.id, { version: 2, request_id: "rest-bad", interest })).status, 400);
    assert.equal((await tool(key, "update_finance_account", { id: restCreated.id, version: 2, request_id: "mcp-bad", interest })).isError, true);
  }
  const stale = { version: 1, request_id: "stale", interest: { annual_rate: "9" } };
  assert.equal((await restPatch(key, restCreated.id, stale)).status, 409);
  assert.equal((await tool(key, "update_finance_account", { ...stale, id: restCreated.id, request_id: "stale-mcp" })).content[0].text, "error: version_conflict: Account changed; refresh before editing");
  for (const card of [{ ...opening, kind: "asset" }, { ...opening, kind: "credit", opening_balance: "0", credit_limit: "100" }]) {
    const rejected = await restCreate(key, { ...card, request_id: "not-money", interest: { annual_rate: "1" } });
    assert.equal((await rejected.json()).code, "invalid_account");
    assert.equal((await tool(key, "create_finance_account", { ...card, request_id: "not-money-mcp", interest: { annual_rate: "1" } })).content[0].text, "error: invalid_account: Choose an active money account");
  }
  assert.deepEqual(configurations(), before);
  assert.equal(getAccount(owner, restCreated.id).version, 2);
});

test("interest settings need manage and write on every transport, other edits only manage", async () => {
  const manager = createApiKey("TEST manager", ["finance:read", "finance:manage"]).key;
  const account = createAccount(owner, { ...opening, request_id: requestId() }).account;
  const interest = { annual_rate: "1" };
  assert.equal((await restCreate(manager, { ...opening, request_id: "m1", interest })).status, 403);
  assert.equal((await tool(manager, "create_finance_account", { ...opening, request_id: "m2", interest })).content[0].text, "error: forbidden: Forbidden: missing scope");
  for (const value of [interest, null]) {
    assert.equal((await restPatch(manager, account.id, { version: 1, request_id: "m3", interest: value })).status, 403);
    assert.equal((await tool(manager, "update_finance_account", { id: account.id, version: 1, request_id: "m4", interest: value })).isError, true);
  }
  assert.deepEqual(configurations(), []);
  assert.equal(getAccount(owner, account.id).version, 1);
  assert.equal((await restPatch(manager, account.id, { version: 1, request_id: "m5", name: "TEST renamed" })).status, 200);
  const writer = createApiKey("TEST writer", ["finance:write"]).key;
  assert.equal((await restPatch(writer, account.id, { version: 2, request_id: "w1", interest })).status, 403);
  assert.deepEqual(configurations(), []);
});

test("interest status is readable with finance:read alone on both transports", async () => {
  const account = createAccount(owner, { ...opening, request_id: requestId(), interest: { annual_rate: "1" } }).account;
  const reader = createApiKey("TEST reader", ["finance:read"]).key;
  const rest = await status(new Request("https://chibako.test/x", { headers: headers(reader) }), { params: Promise.resolve({ id: account.id }) });
  assert.equal(rest.status, 200);
  assert.deepEqual((await tool(reader, "get_finance_account_interest", { id: account.id })).structuredContent, await rest.json());
});

test("retrying a settings save replays once and unchanged settings add no history", () => {
  const account = createAccount(owner, { ...opening, request_id: requestId() }).account;
  const input = { request_id: "TEST-enable", version: 1, interest: { annual_rate: "2" } };
  const first = updateAccount(owner, account.id, input).account;
  assert.deepEqual(updateAccount(owner, account.id, input).account, first);
  assert.equal(configurations().length, 1);
  const same = updateAccount(owner, account.id, { request_id: requestId(), version: 2, interest: { annual_rate: "2.0", frequency: "monthly" } }).account;
  assert.deepEqual(same.interest, first.interest);
  assert.equal(configurations().length, 1);
});

test("same-day edits, disable and re-enable keep one configuration for today", () => {
  const account = createAccount(owner, { ...opening, request_id: requestId(), interest: { annual_rate: "2" } }).account;
  let { version } = account;
  const edit = (interest: object | null) => { version = updateAccount(owner, account.id, { request_id: requestId(), version, interest }).account.version; };
  edit({ annual_rate: "3", withholding_tax: "10" });
  assert.deepEqual(configurations(), [{ start_date: today, end_date: null, annual_rate_scaled: 30000, tax_scaled: 100000, frequency: "monthly" }]);
  edit(null);
  assert.equal(getAccount(owner, account.id).interest, null);
  assert.deepEqual(getInterestProcessingStatus(owner, account.id), { automatic_error: null, accrued_cents: 0, next_payout_date: null });
  edit({ annual_rate: "4" });
  assert.deepEqual(configurations(), [{ start_date: today, end_date: null, annual_rate_scaled: 40000, tax_scaled: 200000, frequency: "monthly" }]);
});

test("a rate edit starts today's rate and keeps earlier accrual on its own payout date", () => {
  const account = enabledSince("2024-03-01", { annual_rate: "36.5", withholding_tax: "0" });
  const edited = updateAccount(owner, account.id, { request_id: requestId(), version: 1, interest: { annual_rate: "73", frequency: "daily" } }).account;
  assert.deepEqual(edited.interest, { annual_rate: "73", withholding_tax: "0", frequency: "daily", start_date: today });
  assert.deepEqual(configurations(), [
    { start_date: "2024-03-01", end_date: today, annual_rate_scaled: 365000, tax_scaled: 0, frequency: "monthly" },
    { start_date: today, end_date: null, annual_rate_scaled: 730000, tax_scaled: 0, frequency: "daily" },
  ]);
});

test("disabling pays accrual through yesterday on the original date, and nothing after", () => {
  // Disable as of 2024-03-11 by closing there: 10 completed days of 1000.00 at 36.5% is 10.00.
  const account = enabledSince("2024-03-01", { annual_rate: "36.5", withholding_tax: "0" });
  updateAccount(owner, account.id, { request_id: requestId(), version: 1, interest: null });
  getDb().prepare("UPDATE finance_interest_configurations SET end_date='2024-03-11'").run();
  assert.deepEqual(getInterestProcessingStatus(owner, account.id, at("2024-03-20")), { automatic_error: null, accrued_cents: 1000, next_payout_date: "2024-04-01" });
  assert.equal(processAutomaticInterest(at("2024-03-31")).posted_count, 0);
  assert.equal(getAccount(owner, account.id).balance_cents, 100000);
  assert.equal(processAutomaticInterest(at("2024-04-01")).posted_count, 1);
  assert.equal(getAccount(owner, account.id).balance_cents, 101000);
  assert.deepEqual(getInterestProcessingStatus(owner, account.id, at("2024-04-02")), { automatic_error: null, accrued_cents: 0, next_payout_date: null });
  assert.equal(processAutomaticInterest(at("2024-06-01")).posted_count, 0);
});

test("status counts completed days only and applies withholding", () => {
  const account = enabledSince("2024-03-01", { annual_rate: "36.5" });
  // Two completed days of 1000.00 at 36.5%, less 20% tax.
  assert.deepEqual(getInterestProcessingStatus(owner, account.id, at("2024-03-03")), { automatic_error: null, accrued_cents: 160, next_payout_date: "2024-04-01" });
});

test("archived accounts refuse interest; restoring does not resume it", () => {
  const account = createAccount(owner, { ...opening, request_id: requestId(), interest: { annual_rate: "2" } }).account;
  const archived = updateAccount(owner, account.id, { request_id: requestId(), version: 1, archived: true }).account;
  assert.equal(archived.interest, null);
  assert.throws(() => updateAccount(owner, account.id, { request_id: requestId(), version: 2, interest: { annual_rate: "2" } }), { code: "invalid_account" });
  const restored = updateAccount(owner, account.id, { request_id: requestId(), version: 2, archived: false }).account;
  assert.equal(restored.interest, null);
  assert.equal(updateAccount(owner, account.id, { request_id: requestId(), version: 3, interest: { annual_rate: "2" } }).account.interest?.annual_rate, "2");
});
