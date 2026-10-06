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
export interface FinanceObligation {
  id: string; kind: z.infer<typeof obligationKindSchema>; name: string; currency: "PHP";
  opening_principal_cents: number; outstanding_cents: number; due_date: string | null;
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
