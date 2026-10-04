import { z } from "zod";
import { createAccountSchema, getAccountSchema } from "./types";
import { calendarDateSchema, monthSchema } from "./activity-types";
export const getBudgetSchema = z.object({ category_id: getAccountSchema.shape.id, month: monthSchema }).strict();
export const setBudgetSchema = getBudgetSchema.extend({
  request_id: createAccountSchema.shape.request_id,
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  mode: z.enum(["forward", "correction"]),
  amount: z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a non-negative PHP limit with up to two decimals"),
}).strict();
export const financeReportSchema = z.object({
  date_from: calendarDateSchema.optional(), date_to: calendarDateSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
}).strict().refine(value => !value.date_from || !value.date_to || value.date_from <= value.date_to, "Start date must not be after end date");
export interface BudgetSnapshot { category_id: string; month: string; version: number; limit_cents: number | null; currency: "PHP" }
export interface CategoryReport { category_id: string | null; name: string; spending_cents: number; budget_cents: number | null; budget_version: number; unbudgeted_cents: number; overspent: boolean }
export interface FinanceReport {
  currency: "PHP"; date_from: string; date_to: string; categories: CategoryReport[]; total: number; limit: number; offset: number;
  income_cents: number; spending_cents: number; unbudgeted_cents: number;
  months: { month: string; income_cents: number; spending_cents: number }[];
  forecast: { available: true; spending_cents: number; income_cents: number };
}
