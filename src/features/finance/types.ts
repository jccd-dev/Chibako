import { z } from "zod";

export const financeScopeSchema = z.enum(["finance:read", "finance:write", "finance:manage"]);
export type FinanceScope = z.infer<typeof financeScopeSchema>;

export type FinanceActor =
  | { kind: "owner" }
  | { kind: "trusted-local" }
  | { kind: "api-key"; id: string; scopes: readonly string[] };

const requestId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const accountId = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(120);
export const accountKindSchema = z.enum(["money", "asset", "credit"]);
export const dueModeSchema = z.enum(["fixed_day", "after_statement"]);
export const accountGroupSchema = z.string().trim().max(80);

const maintainingBalance = z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a non-negative PHP decimal string with at most two decimal places");
const creditLimit = maintainingBalance;
const monthDay = z.number().int().min(1).max(31);
// Day ranges per due mode (1–31 fixed, 1–60 after statement) are checked with the other account kind rules.
const dueValue = z.number().int().min(1).max(60);

export const createAccountSchema = z.object({
  request_id: requestId,
  name,
  kind: accountKindSchema,
  account_group: accountGroupSchema.default(""),
  include_in_summary: z.boolean().default(true),
  currency: z.literal("PHP"),
  maintaining_balance: maintainingBalance.default("0"),
  opening_balance: z.string().max(32).regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a PHP decimal string with at most two decimal places"),
  credit_limit: creditLimit.optional(),
  statement_day: monthDay.optional(),
  due_mode: dueModeSchema.optional(),
  due_value: dueValue.optional(),
}).strict();

export const updateAccountSchema = z.object({
  request_id: requestId,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  name: name.optional(),
  maintaining_balance: maintainingBalance.optional(),
  archived: z.boolean().optional(),
  account_group: accountGroupSchema.optional(),
  include_in_summary: z.boolean().optional(),
  credit_limit: creditLimit.optional(),
  statement_day: monthDay.nullable().optional(),
  due_mode: dueModeSchema.nullable().optional(),
  due_value: dueValue.nullable().optional(),
}).strict().refine(input => Object.keys(input).some(key => key !== "request_id" && key !== "version"), "Provide account settings to update");

export const getAccountSchema = z.object({ id: accountId }).strict();
export const listAccountsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  archived: z.enum(["false", "true", "all"]).default("false"),
  kind: accountKindSchema.optional(),
}).strict();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export interface FinanceAccount {
  id: string;
  name: string;
  kind: z.infer<typeof accountKindSchema>;
  account_group: string;
  include_in_summary: boolean;
  currency: "PHP";
  opening_balance_cents: number;
  maintaining_balance_cents: number;
  planned_expense_cents: number;
  spendable_cents: number;
  balance_cents: number;
  /** Credit settings and derived usage; null for money and asset accounts. */
  credit_limit_cents: number | null;
  statement_day: number | null;
  due_mode: z.infer<typeof dueModeSchema> | null;
  due_value: number | null;
  used_credit_cents: number | null;
  available_credit_cents: number | null;
  archived: boolean;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface FinanceAccountList {
  accounts: FinanceAccount[];
  total: number;
  limit: number;
  offset: number;
}

export interface FinanceSummary {
  currency: "PHP";
  money: { balance_cents: number; account_count: number };
  assets: { balance_cents: number; account_count: number };
  /** Credit balances: negative when owed. Net balance is money plus credit; credit is never an asset. */
  credit: { balance_cents: number; account_count: number };
}

export class FinanceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "FinanceError";
  }
}
