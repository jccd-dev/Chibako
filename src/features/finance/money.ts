import { FinanceError } from "./types";

export function exactCents(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new FinanceError("Amount exceeds the supported exact-cent range", 400, "amount_out_of_range");
  }
  return Number(value);
}

export function decimalCents(decimal: string): number {
  const negative = decimal.startsWith("-");
  const [whole, fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return exactCents(negative ? -cents : cents);
}
