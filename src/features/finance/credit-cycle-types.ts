import { z } from "zod";
import { calendarDateSchema } from "./activity-types";
import { createAccountSchema, getAccountSchema } from "./types";

export interface FinanceCreditCycle {
  statement_date: string;
  cycle_start: string | null;
  soa_date: string;
  due_date: string | null;
  status: "upcoming" | "closed";
  confirmed: boolean;
  balance_cents: number;
  remaining_due_cents: number;
  minimum_due_cents: number | null;
  remaining_minimum_cents: number | null;
}

const amount = createAccountSchema.shape.maintaining_balance.removeDefault();
export const recordCardPaymentSchema = z.object({
  request_id: createAccountSchema.shape.request_id,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  statement_date: calendarDateSchema,
  source_account_id: getAccountSchema.shape.id.optional(),
  amount,
  transaction_date: calendarDateSchema,
  cashbacks: z.array(z.object({
    expense_id: getAccountSchema.shape.id,
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
    amount,
    transaction_date: calendarDateSchema,
  }).strict()).max(100).default([]),
}).strict().refine(input => new Set(input.cashbacks.map(item => item.expense_id)).size === input.cashbacks.length, "Choose each reward once");
