import assert from "node:assert/strict";
import { test } from "node:test";
import { financeBalanceShortfall } from "../src/features/finance/balance-gate";
import type { FinanceAccount } from "../src/features/finance/types";

function account(balance_cents: number, partial: Partial<FinanceAccount> = {}): FinanceAccount {
  return { id: "cash", name: "Cash", kind: "money", account_group: "", include_in_summary: true, currency: "PHP", opening_balance_cents: balance_cents, maintaining_balance_cents: 0, planned_expense_cents: 0, spendable_cents: balance_cents, balance_cents, archived: false, version: 1, created_at: 0, updated_at: 0, ...partial };
}

test("reports a shortfall with raw balance and required debit", () => {
  const result = financeBalanceShortfall({ accounts: [account(4000)], account_id: "cash", amount: "50" });
  assert.ok(result);
  assert.equal(result.available_cents, 4000);
  assert.equal(result.required_cents, 5000);
  assert.equal(result.fee_included, false);
  assert.match(result.message, /Cash has PHP 40\.00/);
  assert.match(result.message, /needs PHP 50\.00/);
});

test("returns null when the raw balance covers the amount", () => {
  assert.equal(financeBalanceShortfall({ accounts: [account(5000)], account_id: "cash", amount: "50" }), null);
  assert.equal(financeBalanceShortfall({ accounts: [account(4999)], account_id: "cash", amount: "49.99" }), null);
});

test("includes only newly posted fees in the required debit", () => {
  const result = financeBalanceShortfall({ accounts: [account(4500)], account_id: "cash", amount: "40", newly_posted_fee_amount: "5.01" });
  assert.ok(result);
  assert.equal(result.required_cents, 4501);
  assert.equal(result.fee_included, true);
  assert.match(result.message, /including the posted fee/);
});

test("an empty fee string adds nothing to the required debit", () => {
  assert.equal(financeBalanceShortfall({ accounts: [account(5000)], account_id: "cash", amount: "50", newly_posted_fee_amount: "" }), null);
});

test("returns null for missing, unparseable, or non-outgoing inputs", () => {
  assert.equal(financeBalanceShortfall({ accounts: [account(1)], account_id: "", amount: "50" }), null);
  assert.equal(financeBalanceShortfall({ accounts: [account(1)], account_id: "cash", amount: "0" }), null);
  assert.equal(financeBalanceShortfall({ accounts: [account(1)], account_id: "cash", amount: "-3" }), null);
  assert.equal(financeBalanceShortfall({ accounts: [account(1)], account_id: "cash", amount: "" }), null);
  assert.equal(financeBalanceShortfall({ accounts: [account(1)], account_id: "missing", amount: "50" }), null);
  assert.equal(financeBalanceShortfall({ accounts: [account(1, { kind: "asset" })], account_id: "cash", amount: "50" }), null);
});
