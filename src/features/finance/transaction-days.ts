import type { FinanceTransaction } from "./activity-types";

export type Direction = "in" | "out" | "neutral";

export function directionOf(type: FinanceTransaction["type"]): Direction {
  if (type === "income" || type === "refund" || type === "borrowing") return "in";
  if (type === "expense" || type === "lending") return "out";
  return "neutral";
}

export interface TransactionDay {
  date: string;
  rows: FinanceTransaction[];
  inCents: number;
  outCents: number;
}

/** Groups rows by transaction_date in the given order; hidden and reverted rows are listed but never totalled. */
export function groupByDay(rows: FinanceTransaction[]): TransactionDay[] {
  const days: TransactionDay[] = [];
  for (const row of rows) {
    let day = days.find((d) => d.date === row.transaction_date);
    if (!day) days.push((day = { date: row.transaction_date, rows: [], inCents: 0, outCents: 0 }));
    day.rows.push(row);
    if (row.hidden || row.reverted) continue;
    const direction = directionOf(row.type);
    if (direction === "in") day.inCents += row.amount_cents;
    if (direction === "out") day.outCents += row.amount_cents;
  }
  return days;
}

/** "Today" / "Yesterday" for the two most recent calendar days, else null (caller formats the date). */
export function relativeDayLabel(date: string, today: string): string | null {
  if (date === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return date === yesterday.toISOString().slice(0, 10) ? "Yesterday" : null;
}
