import { z } from "zod";
import { createAccountSchema, getAccountSchema, updateAccountSchema } from "./types";
import { calendarDateSchema } from "./activity-types";

const id = getAccountSchema.shape.id;
const requestId = createAccountSchema.shape.request_id;
const name = createAccountSchema.shape.name;

export const getGoalSchema = z.object({ id }).strict();
export const deleteGoalSchema = z.object({ request_id: requestId, version: updateAccountSchema.shape.version }).strict();
export const listGoalsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  archived: z.enum(["false", "true", "all"]).default("false"),
}).strict();

export const createGoalSchema = z.object({
  request_id: requestId,
  name,
  target: z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a positive PHP target with up to two decimals"),
  due_date: calendarDateSchema.optional(),
  linked_account_id: id.nullable().optional(),
}).strict();

export const updateGoalSchema = z.object({
  request_id: requestId,
  version: updateAccountSchema.shape.version,
  name: name.optional(),
  target: createGoalSchema.shape.target.optional(),
  due_date: calendarDateSchema.nullable().optional(),
  archived: z.boolean().optional(),
  linked_account_id: id.nullable().optional(),
}).strict().refine(patch => patch.name !== undefined || patch.target !== undefined
  || patch.due_date !== undefined || patch.archived !== undefined || patch.linked_account_id !== undefined, "Provide a goal change");

export interface FinanceGoal {
  id: string;
  name: string;
  currency: "PHP";
  target_cents: number;
  saved_cents: number;
  linked_account_id: string | null;
  linked_account_name: string | null;
  achieved: boolean;
  allocations: FinanceGoalAllocation[];
  due_date: string | null;
  archived: boolean;
  version: number;
  created_at: number;
  updated_at: number;
}

export const setGoalAllocationSchema = z.object({
  request_id: requestId,
  version: updateAccountSchema.shape.version,
  account_id: id,
  amount: createGoalSchema.shape.target,
}).strict();

export const listGoalAccountsSchema = listGoalsSchema;

export const moveGoalMoneySchema = z.object({
  request_id: requestId,
  version: updateAccountSchema.shape.version,
  direction: z.enum(["deposit", "withdrawal"]),
  account_id: id,
  amount: createGoalSchema.shape.target,
}).strict();

export interface FinanceReservationAccount {
  account_id: string;
  account_name: string;
  balance_cents: number;
  reserved_cents: number;
  available_cents: number;
  shortfall_cents: number;
}

export interface FinanceGoalAllocation extends FinanceReservationAccount {
  amount_cents: number;
}

export interface FinanceAllocationShortfall {
  account_id: string;
  reserved_cents: number;
  balance_cents: number;
  shortfall_cents: number;
}

export interface FinanceGoalList {
  goals: FinanceGoal[];
  total: number;
  limit: number;
  offset: number;
  currency: "PHP";
}
