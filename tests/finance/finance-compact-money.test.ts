import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactPHP, formatPHP } from "../../src/features/finance/presentation";

test("compact money truncates display toward zero while preserving exact cents", () => {
  const examples: [number, string, string][] = [
    [0, "PHP 0.00", "PHP 0.00"],
    [99999, "PHP 999.99", "PHP 999.99"],
    [100000, "PHP 1k", "PHP 1,000.00"],
    [50050000, "PHP 500.5k", "PHP 500,500.00"],
    [150000000, "PHP 1.5M", "PHP 1,500,000.00"],
    [123456789, "PHP 1.2M", "PHP 1,234,567.89"],
    [-98765432, "-PHP 987.6k", "-PHP 987,654.32"],
    [99994999, "PHP 999.9k", "PHP 999,949.99"],
    [99995000, "PHP 999.9k", "PHP 999,950.00"],
    [99999999, "PHP 999.9k", "PHP 999,999.99"],
    [-99999999, "-PHP 999.9k", "-PHP 999,999.99"],
    [100000000, "PHP 1M", "PHP 1,000,000.00"],
    [99995000000, "PHP 999.9M", "PHP 999,950,000.00"],
    [100000000000, "PHP 1B", "PHP 1,000,000,000.00"],
    [99995000000000, "PHP 999.9B", "PHP 999,950,000,000.00"],
    [100000000000000, "PHP 1T", "PHP 1,000,000,000,000.00"],
    [123456789012345, "PHP 1.2T", "PHP 1,234,567,890,123.45"],
    [Number.MAX_SAFE_INTEGER, "PHP 90T", "PHP 90,071,992,547,409.91"],
  ];
  for (const [cents, compact, exact] of examples) {
    assert.equal(formatCompactPHP(cents), compact);
    assert.equal(formatPHP(cents), exact);
  }
});

test("compact money rejects fractional, nonfinite, and unsafe cents", () => {
  for (const cents of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatCompactPHP(cents), RangeError);
  }
});
