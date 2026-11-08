import assert from "node:assert/strict";
import test from "node:test";
import type { FinanceTransaction } from "../../src/features/finance/activity-types";
import { groupByDay, relativeDayLabel } from "../../src/features/finance/transaction-days";

const row = (over: Partial<FinanceTransaction>) =>
  ({ id: "x", type: "expense", amount_cents: 100, transaction_date: "2026-11-08", hidden: false, reverted: false, ...over }) as FinanceTransaction;

test("groups by date, totals only visible income and expense", () => {
  const days = groupByDay([
    row({ amount_cents: 500 }),
    row({ type: "income", amount_cents: 700 }),
    row({ type: "transfer", amount_cents: 9000 }),
    row({ amount_cents: 300, reverted: true }),
    row({ amount_cents: 200, transaction_date: "2026-11-07" }),
  ]);
  assert.deepEqual(days.map((d) => [d.date, d.rows.length, d.inCents, d.outCents]), [
    ["2026-11-08", 4, 700, 500],
    ["2026-11-07", 1, 0, 200],
  ]);
});

test("relative labels", () => {
  assert.equal(relativeDayLabel("2026-11-08", "2026-11-08"), "Today");
  assert.equal(relativeDayLabel("2026-11-07", "2026-11-08"), "Yesterday");
  assert.equal(relativeDayLabel("2026-11-01", "2026-11-08"), null);
});
