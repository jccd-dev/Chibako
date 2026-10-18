import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deleteMoneyCharacter,
  displayMoney,
  moneyCaretInDisplay,
  moneyCharactersBefore,
  sanitizeMoneyInput,
} from "../src/features/finance/components/money-input";
import { decimalPHP, decimalPHPInput } from "../src/features/finance/presentation";

test("displayMoney groups whole digits without touching fractions", () => {
  assert.equal(displayMoney(""), "");
  assert.equal(displayMoney("0"), "0");
  assert.equal(displayMoney("1234"), "1,234");
  assert.equal(displayMoney("1234567"), "1,234,567");
  assert.equal(displayMoney("1234.5"), "1,234.5");
  assert.equal(displayMoney("1234."), "1,234.");
  assert.equal(displayMoney(".5"), ".5");
  assert.equal(displayMoney("0.005"), "0.005");
  assert.equal(displayMoney("-1234"), "-1,234");
  assert.equal(displayMoney("-1234.56"), "-1,234.56");
  assert.equal(displayMoney("-.5"), "-.5");
  assert.equal(displayMoney("-"), "-");
  assert.equal(displayMoney("12.345"), "12.345");
  assert.equal(displayMoney("1234.00"), "1,234.00");
});

// sanitize is the gate for editing, not final validation: it strips grouping
// commas, normalizes leading-dot fractions into the "0.5" form the Zod amount
// schemas accept, and keeps drafts that submit validation will reject (extra
// decimals, a bare dot) instead of silently producing a different value.
test("sanitizeMoneyInput strips grouping commas from typed or pasted amounts", () => {
  assert.deepEqual(sanitizeMoneyInput("1,234.56", false), "1234.56");
  assert.deepEqual(sanitizeMoneyInput("12,", false), "12");
  assert.deepEqual(sanitizeMoneyInput("", false), "");
  assert.deepEqual(sanitizeMoneyInput(".", false), ".");
  assert.deepEqual(sanitizeMoneyInput("-.", true), "-.");
  assert.deepEqual(sanitizeMoneyInput("12.", false), "12.");
  assert.deepEqual(sanitizeMoneyInput(".5", false), "0.5");
  assert.deepEqual(sanitizeMoneyInput("-.5", true), "-0.5");
  assert.deepEqual(sanitizeMoneyInput("-,", true), "-");
  assert.deepEqual(sanitizeMoneyInput("-1,234.", true), "-1234.");
});

test("sanitizeMoneyInput accepts extra-decimal drafts but rejects non-numeric edits", () => {
  // "1.234" stays itself so submit validation can reject it, as before.
  assert.deepEqual(sanitizeMoneyInput("1.234", false), "1.234");
  assert.deepEqual(sanitizeMoneyInput("1.2.3", false), null);
  assert.deepEqual(sanitizeMoneyInput("abc", false), null);
  assert.deepEqual(sanitizeMoneyInput("1e5", false), null);
  assert.deepEqual(sanitizeMoneyInput("12 34", false), null);
  assert.deepEqual(sanitizeMoneyInput("-", false), null);
  assert.deepEqual(sanitizeMoneyInput("-", true), "-");
  assert.deepEqual(sanitizeMoneyInput("-.5", false), null);
  assert.deepEqual(sanitizeMoneyInput("1,", false), "1");
  assert.deepEqual(sanitizeMoneyInput("--1", true), null);
});

test("caret mapping keeps the typing position across grouping commas", () => {
  assert.equal(moneyCharactersBefore("1,234", 2), 1);
  assert.equal(moneyCharactersBefore("-5", 1), 0);
  assert.equal(moneyCaretInDisplay("1,234.56", 1), 1);
  assert.equal(moneyCaretInDisplay("1,234.56", 4), 5);
  assert.equal(moneyCaretInDisplay("1,234.56", 5), 6);
  assert.equal(moneyCaretInDisplay("-12", 0), 1);
  assert.equal(moneyCaretInDisplay("123", 5), 3);
});

// A leading dot grows into "0X" in the sanitized value; the inserted zero is a
// significant character in caret coordinates, so typing ".5" ends with the
// caret after the digit the user just typed, while a caret that has not passed
// the dot yet stays before or after the inserted zero as appropriate.
test("typing a leading decimal keeps the caret after the inserted zero", () => {
  assert.equal(moneyCharactersBefore(".5", 2), 3);
  assert.equal(moneyCaretInDisplay("0.5", 3), 3);
  assert.equal(moneyCharactersBefore("-.5", 3), 3);
  assert.equal(moneyCaretInDisplay("-0.5", 3), 4);
});

test("cursors before or right after the leading dot map across the inserted zero", () => {
  assert.equal(moneyCharactersBefore(".5", 0), 0);
  assert.equal(moneyCaretInDisplay("0.5", 0), 0);
  assert.equal(moneyCharactersBefore("-.5", 1), 0);
  assert.equal(moneyCaretInDisplay("-0.5", 0), 1);
  assert.equal(moneyCharactersBefore("-.5", 2), 2);
  assert.equal(moneyCaretInDisplay("-0.5", 2), 3);
});

// Grouping commas are transparent to the caret, so deletion must pull them
// together with the adjacent digit; otherwise repeating Delete/Backspace only
// ever removes a comma and re-grouping puts it back.
test("deleteMoneyCharacter skips grouping commas so repeated deletes do not stall", () => {
  assert.deepEqual(deleteMoneyCharacter("1,234", 1, false), { value: "134", caret: 1, from: 1, to: 3 });
  assert.deepEqual(deleteMoneyCharacter("1234", 1, false), { value: "134", caret: 1, from: 1, to: 2 });
  assert.deepEqual(deleteMoneyCharacter("1,234", 2, true), { value: "234", caret: 0, from: 0, to: 2 });
  assert.deepEqual(deleteMoneyCharacter("1,234,567", 5, false), { value: "1,23467", caret: 5, from: 5, to: 7 });
  assert.deepEqual(deleteMoneyCharacter("1,234,567", 4, false), { value: "1,23,567", caret: 4, from: 4, to: 5 });
  assert.deepEqual(deleteMoneyCharacter("-1,234", 2, true), { value: "-,234", caret: 1, from: 1, to: 2 });
  assert.deepEqual(deleteMoneyCharacter("-1,234", 1, true), { value: "1,234", caret: 0, from: 0, to: 1 });
  assert.deepEqual(deleteMoneyCharacter("-", 1, true), { value: "", caret: 0, from: 0, to: 1 });
  assert.deepEqual(deleteMoneyCharacter("1,234", 0, true), null);
  assert.deepEqual(deleteMoneyCharacter("1,234", 5, false), null);
});

test("type-then-group round trips keep one caret invariant", () => {
  const raw = "19,234.56"; // typed "9" after the leading "1"
  assert.equal(sanitizeMoneyInput(raw, false), "19234.56");
  assert.equal(displayMoney("19234.56"), "19,234.56");
  const caret = moneyCharactersBefore(raw, 2);
  assert.equal(moneyCaretInDisplay("19,234.56", caret), 2);
});

test("decimalPHPInput trims appended fractional zeros only for edit inputs", () => {
  assert.equal(decimalPHP(123456), decimalPHPInput(123456));
  assert.equal(decimalPHPInput(0), "0");
  assert.equal(decimalPHPInput(123450), "1234.5");
  assert.equal(decimalPHPInput(5), "0.05");
  assert.equal(decimalPHPInput(-50), "-0.5");
  assert.equal(decimalPHPInput(-100), "-1");
  assert.equal(decimalPHPInput(1000000), "10000");
});
