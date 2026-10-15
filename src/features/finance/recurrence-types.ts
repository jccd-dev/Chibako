import { z } from "zod";
import { calendarDateSchema } from "./activity-types";
import { createPlanSchema, getPlanSchema, planActionSchema, updatePlanSchema, type FinancePlan } from "./planning-types";

export const intervalUnitSchema = z.enum(["day", "week", "month", "year"]);
const maxOccurrences = z.number().int().min(1).max(4000000);
const handling = z.enum(["manual", "automatic"]);
const intervalCount = z.number().int().min(1).max(10000);
export const createScheduleSchema = createPlanSchema.omit({ due_date: true }).extend({
  obligation_id: getPlanSchema.shape.id.nullable().optional(),
  handling: handling.default("manual"), max_occurrences: maxOccurrences.nullable().default(null),
  total_limit: createPlanSchema.shape.amount.nullable().default(null),
  interval_count: intervalCount, interval_unit: intervalUnitSchema, start_date: calendarDateSchema,
  end_date: calendarDateSchema.nullable().default(null), paused: z.boolean().default(false),
}).strict().refine(value => !value.end_date || value.start_date <= value.end_date, "End date must not precede start date");
export const updateScheduleSchema = z.object(updatePlanSchema.shape).omit({ due_date: true }).extend({
  from_plan_id: getPlanSchema.shape.id.optional(), from_plan_version: planActionSchema.shape.version.optional(), interval_count: intervalCount.optional(), interval_unit: intervalUnitSchema.optional(),
  handling: handling.optional(), max_occurrences: maxOccurrences.nullable().optional(), total_limit: createPlanSchema.shape.amount.nullable().optional(),
  start_date: calendarDateSchema.optional(), end_date: calendarDateSchema.nullable().optional(),
}).strict().refine(value => (value.from_plan_id === undefined) === (value.from_plan_version === undefined), "Provide both occurrence ID and version")
  .refine(value => Object.keys(value).some(key => !["request_id", "version", "from_plan_id", "from_plan_version"].includes(key)), "Provide a schedule change");
export const scheduleActionSchema = planActionSchema.extend({ resume_after: calendarDateSchema.optional() });
export const getScheduleSchema = getPlanSchema;
export const listSchedulesSchema = z.object({
  paused: z.enum(["false", "true", "all"]).default("all"),
  limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  include_details: z.boolean().default(false),
}).strict();
export const catchUpPlansSchema = z.object({ request_id: createPlanSchema.shape.request_id, through_date: calendarDateSchema.optional() }).strict();
export const skipPlansSchema = z.object({
  request_id: createPlanSchema.shape.request_id,
  plans: z.array(z.object({ id: getPlanSchema.shape.id, version: planActionSchema.shape.version }).strict()).min(1).max(100)
    .refine(plans => new Set(plans.map(plan => plan.id)).size === plans.length, "Plans must be unique"),
}).strict();
export interface FinanceSchedule {
  obligation_id: string | null;
  handling: "manual" | "automatic"; max_occurrences: number | null; total_limit_cents: number | null;
  logged_time: string; timezone: string; automatic_error: string | null;
  id: string; type: "income" | "expense"; account_id: string; account_name: string; currency: "PHP"; amount_cents: number;
  category_id: string | null; subcategory_id: string | null; category_name: string | null;
  interval_count: number; interval_unit: z.infer<typeof intervalUnitSchema>; start_date: string; end_date: string | null;
  paused: boolean; version: number; next_due_date: string | null; pending_count?: number;
  text?: string; tag_ids?: string[]; created_at?: number; updated_at?: number;
}
export interface SchedulePage { schedules: FinanceSchedule[]; total: number; limit: number; offset: number }
export interface CatchUpResult { created_count: number; has_more: boolean }
export interface SkippedPlans { plans: FinancePlan[] }
