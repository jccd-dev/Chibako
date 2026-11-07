import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAccounts } from "../../src/features/finance/account-grouping";
import type { FinanceAccount } from "../../src/features/finance/types";

const account = (
  id: string,
  balance: number,
  kind: FinanceAccount["kind"] = "money",
  group = "",
  included = true,
): FinanceAccount => ({
  id,
  name: id,
  kind,
  account_group: group,
  logo: "",
  include_in_summary: included,
  currency: "PHP",
  opening_balance_cents: balance,
  payment_account_id: null, credit_hold_cents: 0, maintaining_balance_cents: 0,
  planned_expense_cents: 0,
  balance_cents: balance,
  spendable_cents: balance,
  credit_limit_cents: null,
  statement_day: null,
  due_mode: null,
  due_value: null,
  used_credit_cents: null,
  available_credit_cents: null,
  statement_date: null,
  statement_balance_cents: null, statement_confirmed: false, statement_version: null, estimated_statement_balance_cents: null, statement_difference_cents: null, minimum_due_cents: null, remaining_minimum_cents: null,
  remaining_due_cents: null,
  next_due_date: null,
  archived: false,
  version: 1,
  created_at: 0,
  updated_at: 0,
});

test("groups separate debit and assets and include every displayed account in group totals", () => {
  const rows = [
    account("a", 1001, "money", "Savings", false),
    account("b", -101, "money", "Savings"),
    account("c", 8000, "asset", "Savings"),
    account("d", 99),
  ];
  assert.deepEqual(
    groupAccounts(rows).map((group) => [
      group.name,
      group.kind,
      group.balance_cents,
      group.accounts.length,
    ]),
    [
      ["Savings", "asset", 8000, 1],
      ["Savings", "money", 900, 2],
      ["Ungrouped", "money", 99, 1],
    ],
  );
});

test("group totals preserve exact cents with cancellation and reject an unsafe final total", () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(
    groupAccounts([account("a", max), account("b", 1), account("c", -max)])[0]
      .balance_cents,
    1,
  );
  assert.throws(
    () => groupAccounts([account("a", max), account("b", 1)]),
    /exact-cent range/,
  );
});
