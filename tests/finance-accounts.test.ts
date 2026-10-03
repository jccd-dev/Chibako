import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount, listAccounts, getAccount, updateAccount, getFinanceSummary } from "../src/features/finance/accounts";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-accounts-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const input = { request_id: "create", name: "Cash", kind: "money", currency: "PHP", opening_balance: "123.45" };
beforeEach(() => getDb().transaction(() => {
  getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_accounts;");
})());
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function create(balance: string, kind = "money") {
  return createAccount(owner, { ...input, request_id: randomUUID(), opening_balance: balance, kind }).account;
}

test("PHP openings preserve signed exact cents and reject unsupported inputs", () => {
  for (const [decimal, cents] of [["0", 0], ["42.00", 4200], ["7.5", 750], ["123.45", 12345], ["-10.01", -1001], ["90071992547409.91", Number.MAX_SAFE_INTEGER], ["-90071992547409.91", Number.MIN_SAFE_INTEGER]] as const) {
    assert.equal(create(decimal).opening_balance_cents, cents);
  }
  for (const decimal of ["1.234", "abc", "01", "1e3", "", "90071992547409.92", "-90071992547409.92"]) assert.throws(() => create(decimal), { status: 400 });
  assert.throws(() => createAccount(owner, { ...input, currency: "USD" }), { status: 400, code: "invalid_input" });
});

test("money and assets stay separate while rename, archive and restore retain holdings", () => {
  const money = create("123.45");
  create("-10.01");
  create("456.78", "asset");
  const expected = { currency: "PHP", money: { balance_cents: 11344, account_count: 2 }, assets: { balance_cents: 45678, account_count: 1 } };
  assert.deepEqual(getFinanceSummary(owner), expected);
  const archived = updateAccount(owner, money.id, { request_id: "archive", version: 1, name: "Wallet", archived: true }).account;
  assert.equal(archived.version, 2);
  assert.equal(archived.opening_balance_cents, 12345);
  assert.equal(listAccounts(owner).total, 2);
  assert.deepEqual(listAccounts(owner, { archived: "true" }).accounts, [archived]);
  assert.deepEqual(getFinanceSummary(owner), expected);
  const restored = updateAccount(owner, money.id, { request_id: "restore", version: 2, archived: false }).account;
  assert.equal(restored.name, "Wallet");
  assert.equal(restored.archived, false);
  assert.equal(restored.balance_cents, 12345);
  assert.deepEqual(getFinanceSummary(owner), expected);
});

test("openings, currency and type are immutable and stale edits have no effects", () => {
  const account = create("1.01");
  for (const patch of [{ opening_balance: "9" }, { currency: "USD" }, { kind: "asset" }]) {
    assert.throws(() => updateAccount(owner, account.id, { request_id: randomUUID(), version: 1, name: "Changed", ...patch }), { status: 400 });
  }
  const renamed = updateAccount(owner, account.id, { request_id: "rename", version: 1, name: "Wallet" }).account;
  const audit = getDb().prepare<[], { before_json: string; after_json: string }>("SELECT before_json, after_json FROM finance_audit WHERE request_id = 'rename'").get();
  assert.ok(audit);
  assert.deepEqual(JSON.parse(audit.before_json), account);
  assert.deepEqual(JSON.parse(audit.after_json), renamed);
  assert.throws(() => updateAccount(owner, account.id, { request_id: "stale", version: 1, archived: true }), { status: 409, code: "version_conflict" });
  assert.deepEqual(getAccount(owner, account.id), renamed);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_audit").get()?.count, 2);
});

test("identical retries return original results after edits and changed reuse conflicts", () => {
  const original = createAccount(owner, input);
  const patch = { request_id: "edit", version: 1, name: "Wallet" };
  const renamed = updateAccount(owner, original.account.id, patch);
  updateAccount(owner, original.account.id, { request_id: "archive", version: 2, archived: true });
  assert.deepEqual(createAccount(owner, input), original);
  assert.deepEqual(updateAccount(owner, original.account.id, patch), renamed);
  assert.throws(() => createAccount(owner, { ...input, name: "Different" }), { status: 409, code: "request_conflict" });
  assert.throws(() => updateAccount(owner, original.account.id, { ...patch, archived: true }), { status: 409, code: "request_conflict" });
  assert.equal(listAccounts(owner, { archived: "all" }).total, 1);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_audit").get()?.count, 3);
});

test("finance scopes are independent, wildcard keys gain nothing and actors namespace retries", () => {
  const account = create("1");
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:write"], ["finance:manage"]]) {
    const actor: FinanceActor = { kind: "api-key", id: "key", scopes };
    assert.throws(() => listAccounts(actor), { status: 403 });
    assert.throws(() => getAccount(actor, account.id), { status: 403 });
    assert.throws(() => getFinanceSummary(actor), { status: 403 });
  }
  const reader: FinanceActor = { kind: "api-key", id: "reader", scopes: ["finance:read"] };
  assert.equal(getAccount(reader, account.id).balance_cents, 100);
  assert.throws(() => createAccount(reader, input), { status: 403 });
  assert.throws(() => updateAccount(reader, account.id, { request_id: "edit", version: 1, name: "Other" }), { status: 403 });
  const key = createApiKey("Manager", ["finance:manage"]);
  const manager: FinanceActor = { kind: "api-key", id: key.id, scopes: ["finance:manage"] };
  createAccount(manager, input);
  createAccount({ kind: "trusted-local" }, input);
  const audits = getDb().prepare<[], { actor_id: string; operation: string; affected_ids: string; before_json: string; after_json: string; created_at: number }>("SELECT * FROM finance_audit").all();
  assert.ok(audits.some(row => row.actor_id === "api-key:" + key.id));
  assert.ok(audits.some(row => row.actor_id === "trusted-local-mcp"));
  assert.equal(JSON.stringify(audits).includes(key.key), false);
  for (const row of audits) {
    assert.ok(row.created_at > 0);
    assert.equal(row.operation, "account.create");
    assert.equal(JSON.parse(row.affected_ids).length, 1);
    assert.equal(JSON.parse(row.before_json), null);
    assert.equal(JSON.parse(row.after_json).version, 1);
  }
});

test("audit failure rolls back account and retry bookkeeping together", () => {
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_finance_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try {
    assert.throws(() => createAccount(owner, input), /audit unavailable/);
    for (const table of ["finance_accounts", "finance_requests", "finance_audit"]) assert.equal(db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM " + table).get()?.count, 0);
  } finally { db.exec("DROP TRIGGER reject_finance_audit"); }
  assert.equal(createAccount(owner, input).account.balance_cents, 12345);
});

test("summary uses exact final totals and rejects totals outside the supported range", () => {
  create("90071992547409.91");
  create("90071992547409.91");
  create("-90071992547409.91");
  assert.equal(getFinanceSummary(owner).money.balance_cents, Number.MAX_SAFE_INTEGER);
  create("0.01");
  assert.throws(() => getFinanceSummary(owner), { status: 422, code: "balance_out_of_range" });
});

test("account reads are bounded, paginated and filter kind and archive explicitly", () => {
  const account = create("1");
  create("2");
  create("3", "asset");
  updateAccount(owner, account.id, { request_id: "archive", version: 1, archived: true });
  const first = listAccounts(owner, { archived: "all", limit: 2 });
  const second = listAccounts(owner, { archived: "all", limit: 2, offset: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.accounts.length, 2);
  assert.equal(second.accounts.length, 1);
  assert.ok(!first.accounts.some(item => item.id === second.accounts[0].id));
  assert.equal(listAccounts(owner, { kind: "asset" }).total, 1);
  assert.equal(listAccounts(owner, { kind: "money" }).total, 1);
  assert.equal(listAccounts(owner, { archived: "true" }).total, 1);
  for (const query of [{ limit: 101 }, { offset: -1 }]) assert.throws(() => listAccounts(owner, query), { status: 400 });
});
