import { z } from "zod";
import { calendarDateSchema } from "./activity-types";

export const MAX_FINANCE_ATTENTION_OFFSET = 1000;

export const financeAttentionSchema = z.object({
  as_of: calendarDateSchema.optional(),
  through_date: calendarDateSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(MAX_FINANCE_ATTENTION_OFFSET).default(0),
}).strict().refine(
  (value) => !value.as_of || !value.through_date || value.as_of <= value.through_date,
  "Attention horizon must be ordered",
);

export interface FinanceOverview {
  currency: "PHP";
  money: { balance_cents: number; account_count: number };
  assets: { balance_cents: number; account_count: number };
  spendable_cents: number;
  allocations: { reserved_cents: number; goal_count: number };
  obligations: { debt_cents: number; receivable_cents: number };
}

export type FinanceAttentionKind =
  | "pending_plan"
  | "obligation_due"
  | "budget_overrun"
  | "allocation_shortfall";

export interface FinanceAttentionItem {
  id: string;
  kind: FinanceAttentionKind;
  reference_id: string;
  title: string;
  target: "planning" | "obligations" | "budgets" | "goals";
  urgency: "overdue" | "due" | "upcoming" | "warning";
  due_date: string | null;
  amount_cents: number;
  currency: "PHP";
}

export interface FinanceAttentionPage {
  items: FinanceAttentionItem[];
  total: number;
  limit: number;
  offset: number;
  as_of: string;
  through_date: string;
  currency: "PHP";
}
