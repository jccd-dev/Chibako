import { z } from "zod";
import { decimalCents, exactCents } from "./money";
import { FinanceError } from "./types";

export const cashbackSchema = z.object({
  mode: z.enum(["percent", "amount"]),
  value: z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a non-negative cashback value with at most two decimal places"),
}).strict();
export type CashbackInput = z.infer<typeof cashbackSchema>;

export function cashbackCents(expenseCents: number, cashback: CashbackInput): number {
  const value = decimalCents(cashback.value);
  if (cashback.mode === "percent" && value > 10000) throw new FinanceError("Cashback percentage cannot exceed 100", 400, "invalid_cashback");
  const amount = cashback.mode === "percent" ? exactCents((BigInt(expenseCents) * BigInt(value) + 5000n) / 10000n) : value;
  if (amount <= 0 || amount > expenseCents) throw new FinanceError("Cashback must round to at least one cent and cannot exceed the expense", 400, "invalid_cashback");
  return amount;
}
