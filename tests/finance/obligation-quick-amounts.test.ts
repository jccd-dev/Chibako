import assert from "node:assert/strict";
import { test } from "node:test";
import { obligationQuickAmounts } from "../../src/features/finance/obligation-quick-amounts";

test("quick amounts lead with Full and Half and hide presets at or above the remaining amount", () => {
  assert.deepEqual(obligationQuickAmounts(150000).map(row => row.cents), [150000, 75000, 50000, 100000]);
  assert.deepEqual(obligationQuickAmounts(100000).map(row => row.cents), [100000, 50000]);
  assert.deepEqual(obligationQuickAmounts(30001).map(row => row.cents), [30001, 15000]);
  assert.deepEqual(obligationQuickAmounts(1).map(row => row.cents), [1]);
  assert.deepEqual(obligationQuickAmounts(0), []);
  assert.deepEqual(obligationQuickAmounts(10_000_000).map(row => row.label), ["Full amount", "Half", "PHP 500.00", "PHP 1,000.00", "PHP 5,000.00"]);
});
