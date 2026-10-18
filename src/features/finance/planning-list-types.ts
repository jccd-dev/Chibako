import { z } from "zod";
import { calendarDateSchema } from "./activity-types";

export const planningFilterSchema = z.enum(["all", "attention", "upcoming", "paused"]);
export type PlanningFilter = z.infer<typeof planningFilterSchema>;
export const listPlanningSchema = z.object({
  filter: planningFilterSchema.default("all"),
  as_of: calendarDateSchema.default(() => new Date().toISOString().slice(0, 10)),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
}).strict();

export interface PlanningItem {
  kind: "schedule" | "one-time";
  id: string;
  title: string;
  type: "income" | "expense";
  amount_cents: number;
  account_name: string;
  handling: "manual" | "automatic";
  interval_count: number | null;
  interval_unit: "day" | "week" | "month" | "year" | null;
  paused: boolean;
  next_due_date: string | null;
  pending_count: number;
  overdue_count: number;
  due_today_count: number;
  manual_due_count: number;
  first_pending_id: string | null;
  automatic_error: string | null;
  status: "overdue" | "due-today" | "upcoming" | "paused" | "ended" | "recorded" | "cancelled";
}

export interface PlanningPage {
  items: PlanningItem[];
  total: number;
  limit: number;
  offset: number;
}
