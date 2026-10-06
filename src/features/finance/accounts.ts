import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { parseFinance as parse, financeMutation } from "./mutations";
import { exactCents, decimalCents as openingCents } from "./money";
import {
  createAccountSchema, updateAccountSchema, getAccountSchema, listAccountsSchema,
  FinanceError, type FinanceAccount, type FinanceActor, type FinanceAccountList, type FinanceSummary,
} from "./types";

type AccountRow = Omit<FinanceAccount, "archived" | "balance_cents"> & { archived: number };

function accountFromRow(row: AccountRow): FinanceAccount {
  let balance = BigInt(row.opening_balance_cents);
  const effects = getDb().prepare("SELECT type, amount_cents FROM finance_transactions WHERE reverted = 0 AND account_id = ?").safeIntegers()
    .iterate(row.id) as Iterable<{ type: string; amount_cents: bigint }>;
  for (const effect of effects) balance += effect.type === "income" ? effect.amount_cents : -effect.amount_cents;
  const movements = getDb().prepare("SELECT account_id, type, amount_cents FROM finance_movements WHERE reverted = 0 AND (account_id = ? OR destination_account_id = ?)").safeIntegers()
    .iterate(row.id, row.id) as Iterable<{ account_id: string; type: string; amount_cents: bigint }>;
  for (const effect of movements) balance += effect.type === "transfer" && effect.account_id === row.id ? -effect.amount_cents : effect.amount_cents;
  const refunds = getDb().prepare("SELECT amount_cents FROM finance_refunds WHERE account_id = ? AND reverted = 0").safeIntegers()
    .iterate(row.id) as Iterable<{ amount_cents: bigint }>;
  for (const refund of refunds) balance += refund.amount_cents;
  const principal = getDb().prepare("SELECT type, amount_cents FROM finance_obligation_movements WHERE account_id = ? AND reverted = 0").safeIntegers()
    .iterate(row.id) as Iterable<{ type: string; amount_cents: bigint }>;
  for (const effect of principal) balance += effect.type === "borrowing" ? effect.amount_cents : -effect.amount_cents;
  return { ...row, archived: row.archived === 1, balance_cents: exactCents(balance) };
}

export function readAccountBalance(id: string): FinanceAccount {
  const row = getDb().prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!row) throw new FinanceError("Account not found", 404, "not_found");
  return accountFromRow(row);
}

export function getAccount(actor: FinanceActor, id: string): FinanceAccount {
  authorizeFinance(actor, "finance:read");
  return readAccountBalance(parse(getAccountSchema, { id }).id);
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
  const db = getDb();
  return db.transaction(() => {
  const rows = db.prepare("SELECT kind, opening_balance_cents FROM finance_accounts")
    .safeIntegers().iterate() as Iterable<{ kind: "money" | "asset"; opening_balance_cents: bigint }>;
  const totals = { money: 0n, assets: 0n };
  const summary: FinanceSummary = { currency: "PHP", money: { balance_cents: 0, account_count: 0 }, assets: { balance_cents: 0, account_count: 0 } };
  for (const row of rows) {
    const kind = row.kind === "money" ? "money" : "assets";
    totals[kind] += row.opening_balance_cents;
    summary[kind].account_count++;
  }
  const effects = db.prepare("SELECT a.kind, t.type, t.amount_cents FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id WHERE t.reverted = 0")
    .safeIntegers().iterate() as Iterable<{ kind: string; type: string; amount_cents: bigint }>;
  for (const effect of effects) totals[effect.kind === "money" ? "money" : "assets"] += effect.type === "income" ? effect.amount_cents : -effect.amount_cents;
  const adjustments = db.prepare("SELECT a.kind, m.amount_cents FROM finance_movements m JOIN finance_accounts a ON a.id = m.account_id WHERE m.type != 'transfer' AND m.reverted = 0")
    .safeIntegers().iterate() as Iterable<{ kind: string; amount_cents: bigint }>;
  for (const effect of adjustments) totals[effect.kind === "money" ? "money" : "assets"] += effect.amount_cents;
  const refunds = db.prepare("SELECT a.kind, r.amount_cents FROM finance_refunds r JOIN finance_accounts a ON a.id = r.account_id WHERE r.reverted = 0")
    .safeIntegers().iterate() as Iterable<{ kind: string; amount_cents: bigint }>;
  for (const refund of refunds) totals[refund.kind === "money" ? "money" : "assets"] += refund.amount_cents;
  const principal = db.prepare("SELECT type, amount_cents FROM finance_obligation_movements WHERE reverted = 0").safeIntegers()
    .iterate() as Iterable<{ type: string; amount_cents: bigint }>;
  for (const effect of principal) totals.money += effect.type === "borrowing" ? effect.amount_cents : -effect.amount_cents;
  if (Object.values(totals).some((total) => total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new FinanceError("Combined balances exceed the supported exact-cent range", 422, "balance_out_of_range");
  }
  summary.money.balance_cents = exactCents(totals.money);
  summary.assets.balance_cents = exactCents(totals.assets);
  return summary;
  })();
}

function mutateAccount(actor: FinanceActor, requestId: string, operation: string, payload: object, change: () => { before: FinanceAccount | null; after: FinanceAccount }): { account: FinanceAccount } {
  return financeMutation(actor, requestId, operation, payload, () => {
    const { before, after } = change();
    return { result: { account: after }, affectedIds: [after.id], before, after };
  });
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
    return { before: null, after: readAccountBalance(id) };
  });
}

export function updateAccount(actor: FinanceActor, id: string, input: unknown): { account: FinanceAccount } {
  authorizeFinance(actor, "finance:manage");
  parse(getAccountSchema, { id });
  const { request_id, ...patch } = parse(updateAccountSchema, input);
  return mutateAccount(actor, request_id, "account.update", { id, ...patch }, () => {
    const before = readAccountBalance(id);
    if (patch.version !== before.version) throw new FinanceError("Account changed; refresh before editing", 409, "version_conflict");
    if (before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Account version limit reached", 409, "version_conflict");
    getDb().prepare("UPDATE finance_accounts SET name = ?, archived = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(patch.name ?? before.name, Number(patch.archived ?? before.archived), now(), id, before.version);
    return { before, after: readAccountBalance(id) };
  });
}
