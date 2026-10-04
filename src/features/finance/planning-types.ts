import { z } from "zod";
import { postTransactionSchema, calendarDateSchema, transactionTypeSchema } from "./activity-types";
import { getAccountSchema } from "./types";
import type { FinanceTransaction } from "./activity-types";

const id = getAccountSchema.shape.id;
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const createPlanSchema = postTransactionSchema.omit({ transaction_date: true, note_ids: true }).extend({ due_date: calendarDateSchema }).strict();
export const planActionSchema = z.object({ request_id: createPlanSchema.shape.request_id, version }).strict();
export const updatePlanSchema = z.object({
  ...planActionSchema.shape,
  type: transactionTypeSchema.optional(), account_id: id.optional(), amount: postTransactionSchema.shape.amount.optional(), due_date: calendarDateSchema.optional(),
  category_id: id.nullable().optional(), subcategory_id: id.nullable().optional(),
  text: postTransactionSchema.shape.text.removeDefault().optional(), tag_ids: z.array(id).max(20).refine(ids => new Set(ids).size === ids.length, "Tags must be unique").optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== "request_id" && key !== "version"), "Provide a plan change");
export const postPlanSchema = planActionSchema.extend({ account_id: id, amount: postTransactionSchema.shape.amount, transaction_date: calendarDateSchema }).strict();
export const matchPlanSchema = planActionSchema.extend({ transaction_id: id, transaction_version: version }).strict();
export const getPlanSchema = z.object({ id, include_details: z.boolean().default(false) }).strict();
export const listPlansSchema = z.object({
  status: z.enum(["pending", "satisfied", "cancelled", "all"]).default("pending"),
  type: transactionTypeSchema.optional(), account_id: id.optional(), schedule_id: id.optional(),
  date_from: calendarDateSchema.optional(), date_to: calendarDateSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  include_details: z.boolean().default(false),
}).strict().refine(value => !value.date_from || !value.date_to || value.date_from <= value.date_to, "Start date must not be after end date");
export interface FinancePlan {
  id: string; type: "income" | "expense"; account_id: string; account_name: string; currency: "PHP"; amount_cents: number;
  due_date: string; category_id: string | null; subcategory_id: string | null; category_name: string | null;
  schedule_id: string | null; occurrence_date: string | null;
  status: "pending" | "satisfied" | "cancelled"; transaction_id: string | null; version: number;
  text?: string; tag_ids?: string[]; created_at?: number; updated_at?: number;
}
export interface PlanPage { plans: FinancePlan[]; total: number; limit: number; offset: number }
export interface SatisfiedPlan { plan: FinancePlan; transaction: FinanceTransaction; balance_cents: number; warnings: string[] }
