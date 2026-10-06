import { z } from "zod";
import { createAccountSchema, getAccountSchema } from "./types";
import { postTransactionSchema, calendarDateSchema, type FinanceTransaction } from "./activity-types";
import type { FinanceAllocationShortfall } from "./goal-types";

const context = {
  request_id: createAccountSchema.shape.request_id,
  currency: z.literal("PHP").default("PHP"),
  transaction_date: calendarDateSchema,
  text: postTransactionSchema.shape.text,
  note_ids: postTransactionSchema.shape.note_ids,
  tag_ids: postTransactionSchema.shape.tag_ids,
};
export const postTransferSchema = z.object({
  ...context,
  source_account_id: getAccountSchema.shape.id,
  destination_account_id: getAccountSchema.shape.id,
  amount: postTransactionSchema.shape.amount,
  fee: z.object({
    amount: postTransactionSchema.shape.amount,
    category_id: getAccountSchema.shape.id,
    subcategory_id: postTransactionSchema.shape.subcategory_id,
  }).strict().optional(),
}).strict().refine(value => value.source_account_id !== value.destination_account_id, "Choose different source and destination accounts");
export const postAdjustmentSchema = z.object({
  ...context,
  account_id: getAccountSchema.shape.id,
  actual_balance: createAccountSchema.shape.opening_balance,
  expected_balance_cents: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
}).strict();
export interface PostedMovement {
  transaction: FinanceTransaction;
  fee: FinanceTransaction | null;
  balances: { account_id: string; balance_cents: number }[];
  warnings: string[];
  allocation_shortfalls?: FinanceAllocationShortfall[];
}
