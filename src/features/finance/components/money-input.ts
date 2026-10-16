// Pure helpers for the finance MoneyInput contract: the state kept by hooks
// is an ungrouped decimal string; commas exist only in the rendered input.
// "Significant" characters for caret mapping are digits and dots; commas and
// the leading minus are transparent formatting.

export function groupThousands(digits: string): string {
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return grouped;
}

export function displayMoney(value: string): string {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? "" : body.slice(dot);
  return (negative ? "-" : "") + groupThousands(whole) + rest;
}

export function sanitizeMoneyInput(raw: string, signed: boolean): string | null {
  const value = raw.replace(/,/g, "");
  if (!(signed ? /^-?(\d+(\.\d*)?|\.\d*)?$/ : /^(\d+(\.\d*)?|\.\d*)?$/).test(value)) return null;
  // A leading decimal point would fail the Zod amount schemas, which expect a
  // digit there; give the draft its zero once a fraction is typed.
  return value.replace(/^(-?)\.(?=\d)/, "$10.");
}

// Comma-aware single-character deletion for grouped MoneyInput text: commas
// are transparent, so Backspace removes the significant character before the
// caret together with any commas between it and the caret, and Delete removes
// the one after the caret the same way. Returns the post-deletion text, its
// caret position, and the deleted [from, to) range; null when there is no
// significant character to delete.
export type MoneyDeletion = { value: string; caret: number; from: number; to: number };

export function deleteMoneyCharacter(display: string, caret: number, backward: boolean): MoneyDeletion | null {
  if (backward) {
    let start = caret - 1;
    while (start >= 0 && display[start] === ",") start -= 1;
    if (start < 0) return null;
    return { value: display.slice(0, start) + display.slice(caret), caret: start, from: start, to: caret };
  }
  let end = caret;
  while (end < display.length && display[end] === ",") end += 1;
  if (end >= display.length) return null;
  return { value: display.slice(0, caret) + display.slice(end + 1), caret, from: caret, to: end + 1 };
}

// Count of significant characters (digits and dots) in text before caretIndex.
// A leading-dot draft like ".5" is normalized into "0.5", so once the caret
// sits past that dot the rendered value holds one extra significant character
// (the inserted zero) that the raw prefix does not contain.
export function moneyCharactersBefore(raw: string, caretIndex: number | null): number {
  const prefix = raw.slice(0, caretIndex ?? raw.length);
  let count = countSignificant(prefix);
  if (/^-?\.\d/.test(raw) && prefix.includes(".")) count += 1;
  return count;
}

function countSignificant(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character >= "0" && character <= "9" || character === ".") count += 1;
  }
  return count;
}

// Caret index in a grouped display that keeps `significant` digits/dots to the
// left: immediately after that character, mirroring native typing. Inserting
// at any position with the same significant count produces the same ungrouped
// value, so the exact choice between comma-adjacent spots is safe.
export function moneyCaretInDisplay(display: string, significant: number): number {
  if (significant <= 0) return display.startsWith("-") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    const character = display[i];
    if (character === "," || character === "-") continue;
    seen += 1;
    if (seen === significant) return i + 1;
  }
  return display.length;
}
