import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createNote, getNote } from "../src/lib/notes";
import { getActivityNoteLinks, setActivityNoteLinks } from "../src/features/finance/note-links";
import { createAccount, getAccount, getFinanceSummary } from "../src/features/finance/accounts";
import { createObligation, getObligation, listObligations, updateObligation, postObligationMovement } from "../src/features/finance/obligations";
import { getActivityTotals, getTransaction, listTransactions } from "../src/features/finance/activity";
import { correctActivity, hideActivity, revertActivity } from "../src/features/finance/corrections";
import { getFinanceReport } from "../src/features/finance/budgets";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-obligations-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_obligation_movements; DELETE FROM finance_obligations; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const request = () => randomUUID();

test("obligation definitions carry principal and optional due dates without changing cash or assets", () => {
  createAccount(owner, { request_id: request(), name: "Obligation test cash", kind: "money", opening_balance: "100", currency: "PHP" });
  const before = getFinanceSummary(owner);
  const input = { request_id: request(), kind: "debt", name: "Existing debt", principal: "25.50", due_date: "2026-10-01" };
  const result = createObligation(owner, input);
  assert.deepEqual(createObligation(owner, input), result);
  assert.throws(() => createObligation(owner, { ...input, principal: "26" }), { code: "request_conflict" });
  assert.equal(result.obligation.outstanding_cents, 2550);
  assert.equal(getObligation(owner, result.obligation.id, { as_of: "2026-10-02" }).overdue, true);
  assert.equal(getObligation(owner, result.obligation.id, { as_of: "2026-10-01" }).overdue, false);
  assert.equal(listObligations(owner, { overdue: true, as_of: "2026-10-02" }).total, 1);
  const edited = updateObligation(owner, result.obligation.id, { request_id: request(), version: 1, due_date: null, name: "Renamed debt" }).obligation;
  assert.equal(edited.due_date, null);
  assert.throws(() => updateObligation(owner, result.obligation.id, { request_id: request(), version: 1, name: "Stale" }), { code: "version_conflict" });
  assert.deepEqual(getFinanceSummary(owner), before);
  assert.throws(() => createObligation(owner, { request_id: request(), kind: "debt", name: "Invalid", principal: "-1" }), { code: "invalid_input" });
  assert.throws(() => createObligation(owner, { ...input, request_id: request(), due_date: "2026-02-30" }), { code: "invalid_input" });
});

test("borrowing and lending link cash to principal, excluding reports; correction, Delete and Revert stay atomic", () => {
  const cash = createAccount(owner, { request_id: request(), name: "Movement test cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const second = createAccount(owner, { request_id: request(), name: "Correction cash", kind: "money", opening_balance: "0", currency: "PHP" }).account;
  const totals = getActivityTotals(owner, { month: "2026-10" });
  const reports = getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" });
  const input = { request_id: request(), type: "borrowing", name: "Actual debt", amount: "50.25", account_id: cash.id, transaction_date: "2026-10-02", due_date: "2026-10-03" };
  const borrowed = postObligationMovement(owner, input);
  assert.equal(borrowed.balances[0].balance_cents, 15025);
  assert.equal(borrowed.obligation.outstanding_cents, 5025);
  assert.equal(borrowed.principal_change_cents, 5025);
  assert.deepEqual(postObligationMovement(owner, input), borrowed);
  assert.throws(() => postObligationMovement(owner, { ...input, amount: "51" }), { code: "request_conflict" });
  const lent = postObligationMovement(owner, { request_id: request(), type: "lending", name: "Actual receivable", amount: "20", account_id: cash.id, transaction_date: "2026-10-02" });
  assert.equal(lent.balances[0].balance_cents, 13025);
  assert.equal(lent.obligation.kind, "receivable");
  assert.equal(lent.obligation.outstanding_cents, 2000);
  assert.deepEqual(getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" }), reports);
  assert.equal(listTransactions(owner, { type: "borrowing" }).transactions.some(row => row.id === borrowed.transaction.id), true);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), totals);
  const correction = { request_id: request(), version: 1, obligation_version: borrowed.obligation.version, amount: "40", account_id: second.id };
  const edited = correctActivity(owner, borrowed.transaction.id, correction);
  assert.deepEqual(correctActivity(owner, borrowed.transaction.id, correction), edited);
  assert.equal(edited.obligation?.outstanding_cents, 4000);
  assert.equal(edited.principal_change_cents, -1025);
  assert.equal(getAccount(owner, cash.id).balance_cents, 8000);
  assert.equal(getAccount(owner, second.id).balance_cents, 4000);
  const deleted = hideActivity(owner, borrowed.transaction.id, { request_id: request(), version: edited.transaction.version, obligation_version: edited.obligation!.version });
  assert.equal(deleted.obligation?.outstanding_cents, 4000);
  assert.equal(getAccount(owner, second.id).balance_cents, 4000);
  assert.equal(getTransaction(owner, borrowed.transaction.id).hidden, true);
  const reverted = revertActivity(owner, borrowed.transaction.id, { request_id: request(), version: deleted.transaction.version, obligation_version: deleted.obligation!.version });
  assert.equal(reverted.obligation?.outstanding_cents, 0);
  assert.equal(reverted.principal_change_cents, -4000);
  assert.equal(getAccount(owner, second.id).balance_cents, 0);
  assert.throws(() => revertActivity(owner, borrowed.transaction.id, { request_id: request(), version: reverted.transaction.version, obligation_version: reverted.obligation!.version }), { code: "already_reverted" });
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), totals);
});

test("posting rejects stale/wrong/archived definitions and invalid accounts; overflow and audit failure roll back both effects", () => {
  const cash = createAccount(owner, { request_id: request(), name: "Boundary cash", kind: "money", opening_balance: "0", currency: "PHP" }).account;
  const asset = createAccount(owner, { request_id: request(), name: "Boundary asset", kind: "asset", opening_balance: "0", currency: "PHP" }).account;
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Boundary debt", principal: "90071992547409.91" }).obligation;
  const input = { request_id: request(), type: "borrowing", obligation_id: debt.id, version: 1, amount: "0.01", account_id: cash.id, transaction_date: "2026-10-02" };
  const before = getAccount(owner, cash.id), history = listTransactions(owner, { hidden: "all", reverted: "all" }).total;
  assert.throws(() => postObligationMovement(owner, input), { code: "amount_out_of_range" });
  assert.deepEqual(getAccount(owner, cash.id), before);
  assert.equal(getObligation(owner, debt.id).version, 1);
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, history);
  assert.throws(() => postObligationMovement(owner, { ...input, version: 2 }), { code: "version_conflict" });
  assert.throws(() => postObligationMovement(owner, { ...input, type: "lending" }), { code: "invalid_obligation" });
  assert.throws(() => postObligationMovement(owner, { ...input, account_id: asset.id }), { code: "invalid_account" });
  updateObligation(owner, debt.id, { request_id: request(), version: 1, archived: true });
  assert.throws(() => postObligationMovement(owner, { ...input, version: 2 }), { code: "invalid_obligation" });
  const fresh = { request_id: request(), type: "lending", name: "Audit rollback receivable", amount: "200", account_id: cash.id, transaction_date: "2026-10-02" };
  const definitions = listObligations(owner, { archived: "all" }).total;
  // Keep aggregate totals in range while testing a separate receivable boundary.
  assert.equal(getObligation(owner, debt.id).outstanding_cents, Number.MAX_SAFE_INTEGER);
  getDb().exec("CREATE TRIGGER fail_obligation_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
  try { assert.throws(() => postObligationMovement(owner, fresh), /synthetic audit failure/); }
  finally { getDb().exec("DROP TRIGGER fail_obligation_audit"); }
  assert.deepEqual(getAccount(owner, cash.id), before);
  assert.equal(listObligations(owner, { archived: "all" }).total, definitions);
  const lent = postObligationMovement(owner, fresh);
  assert.deepEqual(lent.warnings, ["negative_balance"]);
  assert.equal(lent.balances[0].balance_cents, -20000);
  updateObligation(owner, lent.obligation.id, { request_id: request(), version: lent.obligation.version, due_date: "2027-01-01" });
  assert.throws(() => correctActivity(owner, lent.transaction.id, { request_id: request(), version: 1, obligation_version: lent.obligation.version, amount: "1" }), { code: "version_conflict" });
  assert.equal(getAccount(owner, cash.id).balance_cents, -20000);
  assert.equal(getObligation(owner, lent.obligation.id).outstanding_cents, 20000);
  const full = createAccount(owner, { request_id: request(), name: "Full cash", kind: "money", opening_balance: "90071992547409.91", currency: "PHP" }).account;
  assert.throws(() => postObligationMovement(owner, { ...fresh, request_id: request(), type: "borrowing", account_id: full.id, amount: "0.01" }), { code: "amount_out_of_range" });
  assert.equal(listObligations(owner, { archived: "all" }).total, definitions + 1);
});

test("opening the same vault in a second process reapplies schema safely and preserves principal", () => {
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Restart debt", principal: "12.34" }).obligation;
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { getDb } from './src/lib/db.ts'; import { getObligation } from './src/features/finance/obligations.ts'; console.log(getObligation({kind:'owner'}, '${debt.id}').outstanding_cents); getDb().close();`], { encoding: "utf8", env: { ...process.env, CHIBAKO_DATA_DIR: vault } });
  assert.equal(output.trim(), "1234");
  assert.equal(getObligation(owner, debt.id).outstanding_cents, 1234);
});

test("borrowing Note links version the posted activity without changing principal or Notes", () => {
  const cash = createAccount(owner, { request_id: request(), name: "Note-linked cash", kind: "money", opening_balance: "0", currency: "PHP" }).account;
  const posted = postObligationMovement(owner, { request_id: request(), type: "borrowing", name: "Note-linked debt", account_id: cash.id, amount: "10", transaction_date: "2026-10-02" });
  const note = createNote({ title: "Synthetic obligation context", content: "Keep this Note unchanged." });
  const beforeNote = getNote(note.id);
  const input = { request_id: request(), version: 1, note_ids: [note.id] };
  const linked = setActivityNoteLinks(owner, posted.transaction.id, input);
  assert.equal(linked.transaction.version, 2);
  assert.deepEqual(setActivityNoteLinks(owner, posted.transaction.id, input), linked);
  assert.equal(getAccount(owner, cash.id).balance_cents, 1000);
  assert.equal(getObligation(owner, posted.obligation.id).outstanding_cents, 1000);
  assert.deepEqual(getActivityNoteLinks(owner, posted.transaction.id).notes, [{ id: note.id, title: note.title }]);
  assert.throws(() => setActivityNoteLinks(owner, posted.transaction.id, { ...input, request_id: request() }), { code: "version_conflict" });
  const corrected = correctActivity(owner, posted.transaction.id, { request_id: request(), version: 2, obligation_version: 1, amount: "11" });
  assert.equal(corrected.obligation?.outstanding_cents, 1100);
  assert.equal(corrected.balances[0].balance_cents, 1100);
  assert.deepEqual(getNote(note.id), beforeNote);
});
