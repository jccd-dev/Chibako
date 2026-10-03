import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { getDb, now } from "../../lib/db";
import { authorizeFinance, financeActorId } from "../../server/auth/finance-authorization";
import {
  createAccountSchema, updateAccountSchema, getAccountSchema, listAccountsSchema,
  FinanceError, type FinanceAccount, type FinanceActor, type FinanceAccountList, type FinanceSummary,
} from "./types";

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new FinanceError(parsed.error.issues[0]?.message ?? "Invalid input", 400, "invalid_input");
  return parsed.data;
}

function exactCents(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new FinanceError("Amount exceeds the supported exact-cent range", 400, "amount_out_of_range");
  }
  return Number(value);
}

function openingCents(decimal: string): number {
  const negative = decimal.startsWith("-");
  const [whole, fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return exactCents(negative ? -cents : cents);
}

type AccountRow = Omit<FinanceAccount, "archived" | "balance_cents"> & { archived: number };

function accountFromRow(row: AccountRow): FinanceAccount {
  // Posted activity is introduced in the next slice. Openings are never income/spending.
  return { ...row, archived: row.archived === 1, balance_cents: row.opening_balance_cents };
}

function readAccount(id: string): FinanceAccount {
  const row = getDb().prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!row) throw new FinanceError("Account not found", 404, "not_found");
  return accountFromRow(row);
}

export function getAccount(actor: FinanceActor, id: string): FinanceAccount {
  authorizeFinance(actor, "finance:read");
  return readAccount(parse(getAccountSchema, { id }).id);
}

export function listAccounts(actor: FinanceActor, input: unknown = {}): FinanceAccountList {
  authorizeFinance(actor, "finance:read");
  const query = parse(listAccountsSchema, input);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (query.archived !== "all") {
    conditions.push("archived = ?");
    values.push(query.archived === "true" ? 1 : 0);
  }
  if (query.kind) {
    conditions.push("kind = ?");
    values.push(query.kind);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_accounts ${where}`).get(...values) as { total: number };
    const rows = db.prepare(`SELECT * FROM finance_accounts ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...values, query.limit, query.offset) as AccountRow[];
    return { accounts: rows.map(accountFromRow), total, limit: query.limit, offset: query.offset };
  })();
}

export function getFinanceSummary(actor: FinanceActor): FinanceSummary {
  authorizeFinance(actor, "finance:read");
  // Total holdings include archived accounts; archiving never removes money.
  const rows = getDb().prepare("SELECT kind, opening_balance_cents FROM finance_accounts")
    .safeIntegers().iterate() as Iterable<{ kind: "money" | "asset"; opening_balance_cents: bigint }>;
  const totals = { money: 0n, assets: 0n };
  const summary: FinanceSummary = { currency: "PHP", money: { balance_cents: 0, account_count: 0 }, assets: { balance_cents: 0, account_count: 0 } };
  for (const row of rows) {
    const kind = row.kind === "money" ? "money" : "assets";
    totals[kind] += row.opening_balance_cents;
    summary[kind].account_count++;
  }
  if (Object.values(totals).some((total) => total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new FinanceError("Combined balances exceed the supported exact-cent range", 422, "balance_out_of_range");
  }
  summary.money.balance_cents = exactCents(totals.money);
  summary.assets.balance_cents = exactCents(totals.assets);
  return summary;
}

function mutateAccount(actor: FinanceActor, requestId: string, operation: string, payload: object, change: () => { before: FinanceAccount | null; after: FinanceAccount }): { account: FinanceAccount } {
  const db = getDb();
  const actorId = financeActorId(actor);
  const encoded = JSON.stringify(payload);
  // IMMEDIATE serializes the retry check with the write across processes.
  return db.transaction(() => {
    const prior = db.prepare("SELECT operation, payload, result FROM finance_requests WHERE actor_id = ? AND request_id = ?")
      .get(actorId, requestId) as { operation: string; payload: string; result: string } | undefined;
    if (prior) {
      if (prior.operation !== operation || prior.payload !== encoded) {
        throw new FinanceError("Request ID was already used with a different payload", 409, "request_conflict");
      }
      return JSON.parse(prior.result) as { account: FinanceAccount };
    }
    const { before, after } = change();
    const result = { account: after };
    const timestamp = now();
    db.prepare("INSERT INTO finance_audit (id, actor_id, request_id, operation, affected_ids, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), actorId, requestId, operation, JSON.stringify([after.id]), JSON.stringify(before), JSON.stringify(after), timestamp);
    db.prepare("INSERT INTO finance_requests (actor_id, request_id, operation, payload, result, created_at) VALUES (?,?,?,?,?,?)")
      .run(actorId, requestId, operation, encoded, JSON.stringify(result), timestamp);
    return result;
  }).immediate();
}

export function createAccount(actor: FinanceActor, input: unknown): { account: FinanceAccount } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parse(createAccountSchema, input);
  const cents = openingCents(payload.opening_balance);
  return mutateAccount(actor, request_id, "account.create", payload, () => {
    const id = randomUUID();
    const timestamp = now();
    getDb().prepare("INSERT INTO finance_accounts (id, name, kind, currency, opening_balance_cents, archived, version, created_at, updated_at) VALUES (?,?,?,?,?,0,1,?,?)")
      .run(id, payload.name, payload.kind, payload.currency, cents, timestamp, timestamp);
    return { before: null, after: readAccount(id) };
  });
}

export function updateAccount(actor: FinanceActor, id: string, input: unknown): { account: FinanceAccount } {
  authorizeFinance(actor, "finance:manage");
  parse(getAccountSchema, { id });
  const { request_id, ...patch } = parse(updateAccountSchema, input);
  return mutateAccount(actor, request_id, "account.update", { id, ...patch }, () => {
    const before = readAccount(id);
    if (patch.version !== before.version) throw new FinanceError("Account changed; refresh before editing", 409, "version_conflict");
    if (before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Account version limit reached", 409, "version_conflict");
    getDb().prepare("UPDATE finance_accounts SET name = ?, archived = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(patch.name ?? before.name, Number(patch.archived ?? before.archived), now(), id, before.version);
    return { before, after: readAccount(id) };
  });
}
