import { z } from "zod";
import { createAccountSchema, getAccountSchema, updateAccountSchema } from "./types";
import { calendarDateSchema, postTransactionSchema } from "./activity-types";
import type { PostedMovement } from "./movement-types";

const id = getAccountSchema.shape.id;
const requestId = createAccountSchema.shape.request_id;
const version = updateAccountSchema.shape.version;
export const obligationKindSchema = z.enum(["debt", "receivable"]);
export const createObligationSchema = z.object({
  request_id: requestId, kind: obligationKindSchema, name: createAccountSchema.shape.name,
  principal: postTransactionSchema.shape.amount.default("0"), due_date: calendarDateSchema.nullable().default(null),
}).strict();
export const updateObligationSchema = z.object({
  request_id: requestId, version, name: createAccountSchema.shape.name.optional(),
  due_date: calendarDateSchema.nullable().optional(), archived: z.boolean().optional(),
}).strict().refine(p => p.name !== undefined || p.due_date !== undefined || p.archived !== undefined, "Provide an obligation change");
export const getObligationSchema = z.object({ id, as_of: calendarDateSchema.optional() }).strict();
export const listObligationsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  kind: obligationKindSchema.optional(), archived: z.enum(["false", "true", "all"]).default("false"),
  overdue: z.boolean().default(false), as_of: calendarDateSchema.optional(),
}).strict();
export const postObligationMovementSchema = z.object({
  request_id: requestId, type: z.enum(["borrowing", "lending"]),
  obligation_id: id.optional(), version: version.optional(),
  name: createAccountSchema.shape.name.optional(), due_date: calendarDateSchema.nullable().optional(),
  account_id: id, amount: postTransactionSchema.shape.amount, transaction_date: calendarDateSchema,
  text: postTransactionSchema.shape.text, tag_ids: postTransactionSchema.shape.tag_ids,
}).strict().superRefine((p, ctx) => {
  if (p.obligation_id ? p.version === undefined || p.name !== undefined || p.due_date !== undefined : !p.name || p.version !== undefined) {
    ctx.addIssue({ code: "custom", message: "Supply obligation_id and current version, or a name and optional due_date for a new obligation" });
  }
});
export const paymentFeeSchema = z.object({
  type: z.enum(["income", "expense"]), amount: postTransactionSchema.shape.amount,
  category_id: postTransactionSchema.shape.category_id, subcategory_id: postTransactionSchema.shape.subcategory_id,
}).strict();
export const postObligationPaymentSchema = z.object({
  request_id: requestId, obligation_id: id, obligation_version: version,
  fee: paymentFeeSchema.optional(),
  cash_activity_id: id.optional(), cash_activity_version: version.optional(),
  account_id: id, amount: postTransactionSchema.shape.amount, transaction_date: calendarDateSchema,
  text: postTransactionSchema.shape.text,
}).strict().superRefine((p, ctx) => {
  if (p.cash_activity_id ? p.cash_activity_version === undefined : p.cash_activity_version !== undefined) {
    ctx.addIssue({ code: "custom", message: "Existing cash activity requires its current version" });
  }
  if (p.cash_activity_id && p.fee) ctx.addIssue({ code: "custom", message: "Linking existing cash cannot post a new fee" });
});
export const closeObligationSchema = z.object({
  request_id: requestId, version, amount: postTransactionSchema.shape.amount,
  reason: z.string().trim().min(1).max(2000),
}).strict();
export const obligationHistorySchema = z.object({
  id, limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  include_details: z.boolean().default(false),
}).strict();
export interface FinanceObligation {
  id: string; kind: z.infer<typeof obligationKindSchema>; name: string; currency: "PHP";
  opening_principal_cents: number; paid_cents: number; written_off_cents: number;
  outstanding_cents: number; status: "open" | "paid" | "written_off" | "settled"; due_date: string | null;
  overdue: boolean; archived: boolean; version: number; created_at: number; updated_at: number;
}
export interface FinanceObligationList {
  obligations: FinanceObligation[]; total: number; limit: number; offset: number;
  currency: "PHP"; debt_cents: number; receivable_cents: number;
}
export interface PostedObligationMovement extends PostedMovement {
  obligation: FinanceObligation;
  principal_change_cents: number;
}
export interface FinanceObligationHistoryEntry {
  id: string; kind: "payment" | "write_off"; amount_cents: number; transaction_date: string | null;
  version: number; hidden: boolean; reverted: boolean; cash_activity_id: string | null;
  text?: string; reason?: string | null;
  cash_activity?: { id: string; type: "income" | "expense"; account_id: string; account_name: string; amount_cents: number; transaction_date: string; version: number } | null;
}
export interface FinanceObligationHistory {
  entries: FinanceObligationHistoryEntry[]; total: number; limit: number; offset: number;
}
export type PostedObligationPayment = PostedObligationMovement;
