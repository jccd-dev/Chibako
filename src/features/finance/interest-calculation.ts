import { exactCents } from "./money";

export type InterestFrequency = "daily" | "monthly" | "quarterly" | "yearly";
const SCALE = 1_000_000n;
export const INTEREST_DENOMINATOR = 365n * SCALE * SCALE;

export function interestDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError("Invalid interest date");
  return date;
}

export function interestCalendarDate(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new RangeError("Invalid interest processing time");
  const day = new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  interestDate(day);
  return day;
}

export function interestDayAfter(value: string): string {
  const date = interestDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  const result = date.toISOString().slice(0, 10);
  interestDate(result);
  return result;
}

/** Percent input scaled by 10,000; 100% is 1,000,000. */
export function interestPercent(value: string, tax = false): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,4})?$/.test(value)) throw new RangeError("Invalid interest percentage");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || (tax && result > SCALE)) throw new RangeError("Interest percentage out of range");
  return result;
}

export function interestPercentText(scaled: number): string {
  const fraction = String(scaled % 10000).padStart(4, "0").replace(/0+$/, "");
  return `${Math.floor(scaled / 10000)}${fraction ? `.${fraction}` : ""}`;
}

export function interestPayoutDate(day: string, frequency: InterestFrequency): string {
  const date = interestDate(day);
  if (frequency === "daily") return interestDayAfter(day);
  if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + 1, 1);
  else if (frequency === "quarterly") date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3 + 3, 1);
  else if (frequency === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1, 0, 1);
  else throw new RangeError("Invalid interest frequency");
  const result = date.toISOString().slice(0, 10);
  interestDate(result);
  return result;
}

export interface InterestCalculation {
  start_date: string;
  end_date: string;
  through_date: string;
  annual_rate: string;
  withholding_tax: string;
  carry?: bigint;
  closingBalance: (day: string) => number;
}

/** End and through dates are exclusive: unfinished days never accrue. */
export function calculateInterest(input: InterestCalculation) {
  interestDate(input.start_date); interestDate(input.end_date); interestDate(input.through_date);
  if (input.end_date < input.start_date) throw new RangeError("Interest interval is reversed");
  const rate = interestPercent(input.annual_rate), tax = interestPercent(input.withholding_tax, true);
  let numerator = input.carry ?? 0n;
  if (numerator * 2n < -INTEREST_DENOMINATOR || numerator * 2n >= INTEREST_DENOMINATOR) throw new RangeError("Invalid interest carry");
  for (let day = input.start_date; day < input.end_date && day < input.through_date; day = interestDayAfter(day)) {
    const balance = input.closingBalance(day);
    if (!Number.isSafeInteger(balance)) throw new RangeError("Invalid closing balance");
    numerator += BigInt(Math.max(0, balance)) * rate * (SCALE - tax);
  }
  // Floor division gives half-up rounding even when the retained carry is negative.
  const shifted = numerator + INTEREST_DENOMINATOR / 2n;
  const rounded = shifted >= 0n ? shifted / INTEREST_DENOMINATOR : (shifted - INTEREST_DENOMINATOR + 1n) / INTEREST_DENOMINATOR;
  return { amount_cents: exactCents(rounded), carry: numerator - rounded * INTEREST_DENOMINATOR };
}
