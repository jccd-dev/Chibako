import { z } from "zod";
import { createAccountSchema, getAccountSchema } from "./types";
import { noteIdsSchema } from "./note-link-types";
import type { FinanceAllocationShortfall } from "./goal-types";

const id = getAccountSchema.shape.id;
const requestId = createAccountSchema.shape.request_id;
const name = createAccountSchema.shape.name;
export const transactionTypeSchema = z.enum(["expense", "income"]);
export const activityTypeSchema = z.enum(["expense", "income", "transfer", "reconciliation", "valuation", "refund"]);
export const calendarDateSchema = z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/, "Use a valid YYYY-MM-DD transaction date").refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid calendar day");
export const monthSchema = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/, "Use YYYY-MM");
const page = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
};
export const postTransactionSchema = z.object({
  request_id: requestId,
  type: transactionTypeSchema.default("expense"),
  account_id: id,
  amount: z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a positive PHP decimal with at most two decimal places"),
  transaction_date: calendarDateSchema,
  category_id: id.nullable().default(null),
  subcategory_id: id.nullable().default(null),
  text: z.string().max(2000).default(""),
  note_ids: noteIdsSchema.default([]),
  tag_ids: z.array(id).max(20).default([]).refine(ids => new Set(ids).size === ids.length, "Tags must be unique"),
}).strict();
export const listTransactionsSchema = z.object({
  ...page,
  q: z.string().trim().max(200).optional(),
  date_from: calendarDateSchema.optional(),
  date_to: calendarDateSchema.optional(),
  account_id: id.optional(),
  category_id: id.optional(),
  type: activityTypeSchema.optional(),
  matchable: z.boolean().default(false),
  hidden: z.enum(["false", "true", "all"]).default("false"),
  reverted: z.enum(["false", "true", "all"]).default("false"),
  include_details: z.boolean().default(false),
}).strict().refine(query => !query.date_from || !query.date_to || query.date_from <= query.date_to, "Start date must not be after end date");
export const getTransactionSchema = z.object({ id, include_details: z.boolean().default(false) }).strict();
export const activityTotalsSchema = z.object({ month: monthSchema.optional() }).strict();
export const createClassificationSchema = z.object({
  request_id: requestId, kind: z.enum(["category", "tag"]), name,
  type: transactionTypeSchema.optional(), parent_id: id.nullable().default(null),
}).strict().refine(value => value.kind === "category" ? !!value.type : !value.type && value.parent_id === null, "Categories require an income/expense type; tags have no type or parent");
export const updateClassificationSchema = z.object({
  request_id: requestId, version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  name: name.optional(), archived: z.boolean().optional(),
}).strict().refine(value => value.name !== undefined || value.archived !== undefined, "Provide name or archived");
export const listClassificationsSchema = z.object({
  ...page, kind: z.enum(["category", "tag"]).optional(), type: transactionTypeSchema.optional(),
  archived: z.enum(["false", "true", "all"]).default("false"),
}).strict();
export interface FinanceClassification {
  id: string; kind: "category" | "tag"; type: "income" | "expense" | null; name: string; parent_id: string | null;
  archived: boolean; version: number; created_at: number; updated_at: number;
}
export interface FinanceTransaction {
  id: string; type: z.infer<typeof activityTypeSchema>; account_id: string; currency: "PHP"; amount_cents: number;
  transaction_date: string; category_id: string | null; subcategory_id: string | null; version: number;
  account_name: string; category_name: string | null; subcategory_name: string | null;
  destination_account_id?: string | null; destination_account_name?: string | null;
  linked_record_id?: string | null; fee_transaction_id?: string | null;
  compared_balance_cents?: number | null; actual_balance_cents?: number | null;
  hidden: boolean; reverted: boolean; expense_id: string | null; refunded_cents: number;
  text?: string; tag_ids?: string[]; created_at?: number; updated_at?: number;
}
export interface ActivityPage { transactions: FinanceTransaction[]; total: number; limit: number; offset: number }
export interface ClassificationPage { classifications: FinanceClassification[]; total: number; limit: number; offset: number }
export interface ActivityTotals { currency: "PHP"; month: string; income_cents: number; expense_cents: number }
export interface PostedTransaction { transaction: FinanceTransaction; balance_cents: number; warnings: string[]; allocation_shortfalls?: FinanceAllocationShortfall[] }
