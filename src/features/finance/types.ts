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
export const accountKindSchema = z.enum(["money", "asset"]);

export const createAccountSchema = z.object({
  request_id: requestId,
  name,
  kind: accountKindSchema,
  currency: z.literal("PHP"),
  opening_balance: z.string().max(32).regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Use a PHP decimal string with at most two decimal places"),
}).strict();

export const updateAccountSchema = z.object({
  request_id: requestId,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  name: name.optional(),
  archived: z.boolean().optional(),
}).strict().refine(input => input.name !== undefined || input.archived !== undefined, "Provide name or archived");

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
  currency: "PHP";
  opening_balance_cents: number;
  balance_cents: number;
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
}

export class FinanceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "FinanceError";
  }
}
