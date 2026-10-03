import { z } from "zod";
import { getAccountSchema, createAccountSchema } from "./types";
import { postTransactionSchema, calendarDateSchema } from "./activity-types";
import type { PostedMovement } from "./movement-types";

const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const context = { request_id: createAccountSchema.shape.request_id, version };
export const activityActionSchema = z.object(context).strict();
export const recordRefundSchema = z.object({
  ...context, account_id: getAccountSchema.shape.id, amount: postTransactionSchema.shape.amount,
  transaction_date: calendarDateSchema, text: postTransactionSchema.shape.text,
}).strict();
export const correctActivitySchema = z.object({
  ...context,
  account_id: getAccountSchema.shape.id.optional(),
  destination_account_id: getAccountSchema.shape.id.optional(),
  amount: createAccountSchema.shape.opening_balance.optional(),
  transaction_date: calendarDateSchema.optional(),
  category_id: getAccountSchema.shape.id.nullable().optional(),
  subcategory_id: getAccountSchema.shape.id.nullable().optional(),
  text: z.string().max(2000).optional(),
  tag_ids: z.array(getAccountSchema.shape.id).max(20).refine(ids => new Set(ids).size === ids.length, "Tags must be unique").optional(),
  fee: z.object({ version, amount: postTransactionSchema.shape.amount,
    category_id: postTransactionSchema.shape.category_id, subcategory_id: postTransactionSchema.shape.subcategory_id,
  }).strict().optional(),
}).strict().refine(value => value.account_id !== undefined || value.destination_account_id !== undefined || value.amount !== undefined
  || value.transaction_date !== undefined || value.category_id !== undefined || value.subcategory_id !== undefined
  || value.text !== undefined || value.tag_ids !== undefined || value.fee !== undefined, "Provide a correction");
export interface CorrectedActivity extends PostedMovement {
  expense?: { id: string; version: number; amount_cents: number; refunded_cents: number };
}
