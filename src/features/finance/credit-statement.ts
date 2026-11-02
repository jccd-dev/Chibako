import type { FinanceAccount } from "./types";

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** The given day in a month (zero-based, may overflow into other years), clamped to that month's last day. */
function clampedDate(year: number, monthIndex: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))));
}

/** The latest statement close on or before asOf; a day past month end closes on the month's last day. */
export function statementDate(statementDay: number, asOf: string): string {
  const [year, month] = asOf.split("-").map(Number);
  const current = clampedDate(year, month - 1, statementDay);
  return current <= asOf ? current : clampedDate(year, month - 2, statementDay);
}

/** Fixed day in the month after the statement (clamped), or N days after the statement. */
export function statementDueDate(statement: string, mode: NonNullable<FinanceAccount["due_mode"]>, value: number): string {
  const [year, month, day] = statement.split("-").map(Number);
  if (mode === "after_statement") return formatDate(new Date(Date.UTC(year, month - 1, day + value)));
  return clampedDate(year, month, value);
}
