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
import { correctActivity, hideActivity, revertActivity, recordRefund } from "../src/features/finance/corrections";
import { getFinanceReport } from "../src/features/finance/budgets";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-obligations-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_obligation_writeoffs; DELETE FROM finance_obligation_payments; DELETE FROM finance_obligation_movements; DELETE FROM finance_plans; DELETE FROM finance_refunds; DELETE FROM finance_transactions; DELETE FROM finance_obligations; DELETE FROM finance_accounts;"));
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

test("partial payments use one cash effect, correct/revert with progress, and write-offs close only the remainder", async () => {
  const { postObligationPayment, closeObligation, getObligationPaymentHistory } = await import("../src/features/finance/obligations");
  const cash = createAccount(owner, { request_id: request(), name: "Payment cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const feeCash = createAccount(owner, { request_id: request(), name: "Interest cash", kind: "money", opening_balance: "2", currency: "PHP" }).account;
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Payment debt", principal: "50" }).obligation;
  const paymentInput = { request_id: request(), obligation_id: debt.id, obligation_version: debt.version, amount: "20", transaction_date: "2026-10-04", account_id: cash.id, text: "Installment" };
  const paid = postObligationPayment(owner, paymentInput);
  assert.deepEqual(postObligationPayment(owner, paymentInput), paid);
  assert.equal(paid.obligation.outstanding_cents, 3000);
  assert.equal(paid.obligation.paid_cents, 2000);
  assert.equal(getAccount(owner, cash.id).balance_cents, 8000);
  assert.throws(() => postObligationPayment(owner, { ...paymentInput, request_id: request(), amount: "1" }), { code: "version_conflict" });
  const { postTransaction } = await import("../src/features/finance/activity");
  postTransaction(owner, { request_id: request(), type: "expense", account_id: feeCash.id, amount: "2", transaction_date: "2026-10-04", text: "Explicit interest" });
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), { currency: "PHP", month: "2026-10", income_cents: 0, expense_cents: 200 });
  assert.equal(getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" }).spending_cents, 200);
  const corrected = correctActivity(owner, paid.transaction.id, { request_id: request(), version: paid.transaction.version, obligation_version: paid.obligation.version, amount: "25" });
  assert.equal(corrected.obligation?.outstanding_cents, 2500);
  assert.equal(corrected.obligation?.paid_cents, 2500);
  assert.equal(getAccount(owner, cash.id).balance_cents, 7500);
  assert.throws(() => correctActivity(owner, paid.transaction.id, { request_id: request(), version: corrected.transaction.version, obligation_version: corrected.obligation!.version, amount: "60" }), { code: "overpayment" });
  const history = getObligationPaymentHistory(owner, debt.id, { limit: 10, offset: 0, include_details: true });
  assert.equal(history.entries[0].text, "Installment");
  const hidden = hideActivity(owner, paid.transaction.id, { request_id: request(), version: corrected.transaction.version, obligation_version: corrected.obligation!.version });
  assert.equal(hidden.obligation?.paid_cents, 2500);
  const totalsBeforeClose = getActivityTotals(owner, { month: "2026-10" });
  const reportBeforeClose = getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" });
  const closeInput = { request_id: request(), version: hidden.obligation!.version, amount: "25", reason: "Forgiven remainder" };
  const closed = closeObligation(owner, debt.id, closeInput).obligation;
  assert.equal(closed.outstanding_cents, 0);
  assert.equal(closed.paid_cents, 2500);
  assert.equal(closed.written_off_cents, 2500);
  assert.equal(closed.status, "settled");
  assert.equal(getAccount(owner, cash.id).balance_cents, 7500);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), totalsBeforeClose);
  assert.deepEqual(getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" }), reportBeforeClose);
  const reopened = revertActivity(owner, paid.transaction.id, { request_id: request(), version: hidden.transaction.version, obligation_version: closed.version });
  assert.equal(reopened.obligation?.outstanding_cents, 2500);
  assert.equal(reopened.obligation?.paid_cents, 0);
  assert.equal(reopened.obligation?.status, "open");
  assert.equal(reopened.principal_change_cents, 2500);
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
  assert.throws(() => closeObligation(owner, debt.id, { ...closeInput, request_id: request(), version: reopened.obligation!.version, amount: "24" }), { code: "writeoff_mismatch" });
});

test("existing cash activity can back one payment; overpayment and reuse reject", async () => {
  const { postObligationPayment } = await import("../src/features/finance/obligations");
  const cash = createAccount(owner, { request_id: request(), name: "Linked cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Linked debt", principal: "10" }).obligation;
  const expense = (await import("../src/features/finance/activity")).postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-05" }).transaction;
  const input = { request_id: request(), obligation_id: debt.id, obligation_version: debt.version, amount: "10", transaction_date: "2026-10-05", account_id: cash.id, cash_activity_id: expense.id, cash_activity_version: expense.version };
  assert.throws(() => postObligationPayment(owner, { ...input, request_id: request(), amount: "9" }), { code: "invalid_cash_activity" });
  const result = postObligationPayment(owner, input);
  assert.equal(result.transaction.id, expense.id);
  assert.equal(getAccount(owner, cash.id).balance_cents, 9000);
  const otherDebt = createObligation(owner, { request_id: request(), kind: "debt", name: "Other debt", principal: "10" }).obligation;
  assert.throws(() => postObligationPayment(owner, { ...input, request_id: request(), obligation_id: otherDebt.id, obligation_version: otherDebt.version,
    cash_activity_version: getTransaction(owner, expense.id).version }), { code: "cash_activity_reused" });
});

test("principal cannot be reduced or reverted below payments and write-offs", async () => {
  const { postObligationPayment, closeObligation } = await import("../src/features/finance/obligations");
  const cash = createAccount(owner, { request_id: request(), name: "Protected principal cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Protected principal", principal: "0" }).obligation;
  const borrowed = postObligationMovement(owner, { request_id: request(), type: "borrowing", obligation_id: debt.id, version: debt.version, account_id: cash.id, amount: "20", transaction_date: "2026-10-06" });
  const payment = postObligationPayment(owner, { request_id: request(), obligation_id: debt.id, obligation_version: borrowed.obligation.version, account_id: cash.id, amount: "10", transaction_date: "2026-10-06" });
  assert.throws(() => correctActivity(owner, borrowed.transaction.id, { request_id: request(), version: borrowed.transaction.version, obligation_version: payment.obligation.version, amount: "5" }), { code: "principal_in_use" });
  assert.throws(() => revertActivity(owner, borrowed.transaction.id, { request_id: request(), version: borrowed.transaction.version, obligation_version: payment.obligation.version }), { code: "principal_in_use" });
  const closed = closeObligation(owner, debt.id, { request_id: request(), version: payment.obligation.version, amount: "10", reason: "Written off" }).obligation;
  assert.throws(() => correctActivity(owner, borrowed.transaction.id, { request_id: request(), version: borrowed.transaction.version, obligation_version: closed.version, amount: "5" }), { code: "principal_in_use" });
  assert.equal(getObligation(owner, debt.id).outstanding_cents, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 11000);
});

test("multiple collections settle a receivable without income and corrections move cash and reopen it", async () => {
  const { postObligationPayment, getObligationPaymentHistory } = await import("../src/features/finance/obligations");
  const { postTransaction } = await import("../src/features/finance/activity");
  const cash = createAccount(owner, { request_id: request(), name: "Collection cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const other = createAccount(owner, { request_id: request(), name: "Corrected collection cash", kind: "money", opening_balance: "0", currency: "PHP" }).account;
  const receivable = createObligation(owner, { request_id: request(), kind: "receivable", name: "Partial collections", principal: "30", due_date: "2026-10-01" }).obligation;
  const first = postObligationPayment(owner, { request_id: request(), obligation_id: receivable.id, obligation_version: receivable.version, account_id: cash.id, amount: "10", transaction_date: "2026-10-02" });
  assert.equal(first.balances[0].balance_cents, 11000);
  assert.equal(first.obligation.outstanding_cents, 2000);
  const existing = postTransaction(owner, { request_id: request(), type: "income", account_id: cash.id, amount: "20", transaction_date: "2026-10-03" }).transaction;
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 2000);
  const second = postObligationPayment(owner, { request_id: request(), obligation_id: receivable.id, obligation_version: first.obligation.version, account_id: cash.id, amount: "20", transaction_date: "2026-10-03", cash_activity_id: existing.id, cash_activity_version: existing.version });
  assert.equal(second.balances[0].balance_cents, 13000);
  assert.equal(second.obligation.paid_cents, 3000);
  assert.equal(second.obligation.status, "paid");
  assert.equal(listObligations(owner, { overdue: true, as_of: "2026-10-04" }).total, 0);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 0);
  assert.equal(getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" }).income_cents, 0);
  assert.equal(getObligationPaymentHistory(owner, receivable.id).total, 2);
  const linkedActivity = listTransactions(owner, { obligation_id: receivable.id });
  assert.equal(linkedActivity.total, 2);
  assert.deepEqual(new Set(linkedActivity.transactions.map(row => row.id)), new Set([first.transaction.id, second.transaction.id]));
  const edited = correctActivity(owner, second.transaction.id, { request_id: request(), version: second.transaction.version, obligation_version: second.obligation.version, account_id: other.id, amount: "15", transaction_date: "2026-10-04" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 11000);
  assert.equal(getAccount(owner, other.id).balance_cents, 1500);
  assert.equal(edited.obligation?.outstanding_cents, 500);
  assert.equal(edited.obligation?.status, "open");
  const reverted = revertActivity(owner, first.transaction.id, { request_id: request(), version: first.transaction.version, obligation_version: edited.obligation!.version });
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
  assert.equal(reverted.obligation?.paid_cents, 1500);
  assert.equal(reverted.obligation?.outstanding_cents, 1500);
});

test("ordinary plans and principal payments cannot claim the same cash activity in either order", async () => {
  const { postObligationPayment } = await import("../src/features/finance/obligations");
  const { createPlan, postPlan, matchPlan, getPlan } = await import("../src/features/finance/planning");
  const cash = createAccount(owner, { request_id: request(), name: "Plan/payment boundary cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Plan/payment boundary debt", principal: "20" }).obligation;
  const planInput = { type: "expense", account_id: cash.id, amount: "10", due_date: "2026-10-07" };
  const plan = createPlan(owner, { request_id: request(), ...planInput }).plan;
  const posted = postPlan(owner, plan.id, { request_id: request(), version: plan.version, account_id: cash.id, amount: "10", transaction_date: "2026-10-07" });
  assert.throws(() => postObligationPayment(owner, { request_id: request(), obligation_id: debt.id, obligation_version: debt.version, account_id: cash.id, amount: "10", transaction_date: "2026-10-07", cash_activity_id: posted.transaction.id, cash_activity_version: posted.transaction.version }), { code: "invalid_cash_activity" });
  assert.equal(listTransactions(owner, { payment_matchable: true }).total, 0);
  assert.equal(getPlan(owner, plan.id).status, "satisfied");
  assert.equal(getObligation(owner, debt.id).paid_cents, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 9000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 1000);
  const payment = postObligationPayment(owner, { request_id: request(), obligation_id: debt.id, obligation_version: debt.version, account_id: cash.id, amount: "10", transaction_date: "2026-10-07" });
  const pending = createPlan(owner, { request_id: request(), ...planInput }).plan;
  assert.throws(() => matchPlan(owner, pending.id, { request_id: request(), version: pending.version, transaction_id: payment.transaction.id, transaction_version: payment.transaction.version }), { code: "invalid_match" });
  assert.equal(listTransactions(owner, { matchable: true }).total, 0);
  assert.equal(getPlan(owner, pending.id).status, "pending");
  assert.equal(getAccount(owner, cash.id).balance_cents, 8000);
  assert.equal(getObligation(owner, debt.id).paid_cents, 1000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 1000);
});

test("hidden, reverted, or previously refunded cash activity cannot be linked", async () => {
  const { postObligationPayment } = await import("../src/features/finance/obligations");
  const { postTransaction } = await import("../src/features/finance/activity");
  const cash = createAccount(owner, { request_id: request(), name: "Filtered cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Filtered debt", principal: "100" }).obligation;
  const hidden = postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-07" }).transaction;
  const hiddenActivity = hideActivity(owner, hidden.id, { request_id: request(), version: hidden.version });
  const tryLink = (id: string, version: number, request_id = request()) => postObligationPayment(owner, { request_id,
    obligation_id: debt.id, obligation_version: getObligation(owner, debt.id).version, account_id: cash.id,
    amount: "10", transaction_date: "2026-10-07", cash_activity_id: id, cash_activity_version: version });
  assert.throws(() => tryLink(hidden.id, hiddenActivity.transaction.version), { code: "invalid_cash_activity" });
  const reverted = postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-07" }).transaction;
  const reversed = revertActivity(owner, reverted.id, { request_id: request(), version: reverted.version });
  assert.throws(() => tryLink(reverted.id, reversed.transaction.version), { code: "invalid_cash_activity" });
  const refunded = postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-07" }).transaction;
  recordRefund(owner, refunded.id, { request_id: request(), version: refunded.version, account_id: cash.id, amount: "1", transaction_date: "2026-10-07" });
  assert.throws(() => tryLink(refunded.id, refunded.version), { code: "invalid_cash_activity" });
  assert.equal(listTransactions(owner, { payment_matchable: true }).total, 0);
  const eligible = postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-07" }).transaction;
  const candidates = listTransactions(owner, { payment_matchable: true, limit: 1 });
  assert.equal(candidates.total, 1);
  assert.equal(candidates.transactions[0].id, eligible.id);
  tryLink(eligible.id, eligible.version);
  assert.equal(listTransactions(owner, { payment_matchable: true }).total, 0);
});
