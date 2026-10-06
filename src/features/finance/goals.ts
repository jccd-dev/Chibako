import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { parseFinance, financeMutation } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { readAccountBalance, listAccounts } from "./accounts";
import { reservedAccountCents, reservationAmounts } from "./reservations";
import { FinanceError, type FinanceActor } from "./types";
import { createGoalSchema, updateGoalSchema, listGoalsSchema, getGoalSchema, listGoalAccountsSchema, setGoalAllocationSchema, type FinanceGoal, type FinanceGoalList, type FinanceReservationAccount } from "./goal-types";

type GoalRow = Omit<FinanceGoal, "archived" | "allocations" | "achieved"> & { archived: number };

function goalFromRow(row: GoalRow): FinanceGoal {
  const rows = getDb().prepare("SELECT account_id, amount_cents FROM finance_goal_allocations WHERE goal_id = ? ORDER BY account_id")
    .all(row.id) as { account_id: string; amount_cents: number }[];
  const allocations = rows.map(allocation => ({ ...readReservationAccount(allocation.account_id), amount_cents: allocation.amount_cents }));
  const saved_cents = exactCents(allocations.reduce((sum, allocation) => sum + BigInt(allocation.amount_cents), 0n));
  return { ...row, saved_cents, achieved: saved_cents >= row.target_cents, allocations, due_date: row.due_date ?? null, archived: row.archived === 1, currency: "PHP" };
}

function readReservationAccount(id: string): FinanceReservationAccount {
  const account = readAccountBalance(id);
  return { account_id: id, account_name: account.name, balance_cents: account.balance_cents,
    ...reservationAmounts(account.balance_cents, reservedAccountCents(id)) };
}

function readGoal(id: string): FinanceGoal {
  const row = getDb().prepare("SELECT * FROM finance_goals WHERE id = ?").get(id) as GoalRow | undefined;
  if (!row) throw new FinanceError("Goal not found", 404, "not_found");
  return goalFromRow(row);
}

export function getGoal(actor: FinanceActor, id: string): FinanceGoal {
  authorizeFinance(actor, "finance:read");
  parseFinance(getGoalSchema, { id });
  return getDb().transaction(() => readGoal(id))();
}

export function listGoalAccounts(actor: FinanceActor, input: unknown = {}) {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listGoalAccountsSchema, input);
  return getDb().transaction(() => {
    const page = listAccounts(actor, { ...query, kind: "money" });
    return { ...page, currency: "PHP" as const, accounts: page.accounts.map(account => ({
      ...readReservationAccount(account.id), archived: account.archived,
    })) };
  })();
}

function editableGoal(id: string, version: number) {
  const before = readGoal(id);
  if (version !== before.version || before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Goal changed; refresh before editing", 409, "version_conflict");
  if (before.archived) throw new FinanceError("Archived goals are read-only", 409, "goal_archived");
  return before;
}

export function listGoals(actor: FinanceActor, input: unknown = {}): FinanceGoalList {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listGoalsSchema, input);
  const where = query.archived === "all" ? "" : ` WHERE archived = ${query.archived === "true" ? 1 : 0}`;
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_goals${where}`).get() as { total: number };
    const rows = db.prepare(`SELECT * FROM finance_goals${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(query.limit, query.offset) as GoalRow[];
    return { goals: rows.map(goalFromRow), total, limit: query.limit, offset: query.offset, currency: "PHP" as const };
  })();
}

function mutateGoal(actor: FinanceActor, requestId: string, operation: string, payload: object, change: () => { before: FinanceGoal | null; after: FinanceGoal }): { goal: FinanceGoal } {
  return financeMutation(actor, requestId, operation, payload, () => {
    const { before, after } = change();
    return { result: { goal: after }, affectedIds: [after.id, ...after.allocations.map(row => row.account_id)], before, after };
  });
}

export function createGoal(actor: FinanceActor, input: unknown): { goal: FinanceGoal } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(createGoalSchema, input);
  const targetCents = decimalCents(payload.target);
  if (targetCents <= 0) throw new FinanceError("Use a target above PHP 0.00", 400, "invalid_input");
  return mutateGoal(actor, request_id, "goal.create", payload, () => {
    const id = randomUUID();
    const timestamp = now();
    getDb().prepare("INSERT INTO finance_goals (id, name, target_cents, saved_cents, due_date, archived, version, created_at, updated_at) VALUES (?,?,?,?,?,0,1,?,?)")
      .run(id, payload.name, targetCents, 0, payload.due_date ?? null, timestamp, timestamp);
    return { before: null, after: readGoal(id) };
  });
}

export function updateGoal(actor: FinanceActor, id: string, input: unknown): { goal: FinanceGoal } {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getGoalSchema, { id });
  const { request_id, ...patch } = parseFinance(updateGoalSchema, input);
  const targetCents = patch.target === undefined ? null : decimalCents(patch.target);
  if (targetCents !== null && targetCents <= 0) throw new FinanceError("Use a target above PHP 0.00", 400, "invalid_input");
  return mutateGoal(actor, request_id, "goal.update", { id, ...patch }, () => {
    const before = editableGoal(id, patch.version);
    const assignments: string[] = [], values: (string | number | null)[] = [];
    if (patch.name !== undefined) { assignments.push("name = ?"); values.push(patch.name); }
    if (targetCents !== null) { assignments.push("target_cents = ?"); values.push(targetCents); }
    if (patch.due_date !== undefined) { assignments.push("due_date = ?"); values.push(patch.due_date ?? null); }
    if (patch.archived !== undefined) { assignments.push("archived = ?"); values.push(patch.archived ? 1 : 0); }
    getDb().prepare(`UPDATE finance_goals SET ${assignments.join(", ")}, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(...values, now(), id);
    return { before, after: readGoal(id) };
  });
}

export function setGoalAllocation(actor: FinanceActor, id: string, input: unknown) {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getGoalSchema, { id });
  const { request_id, ...payload } = parseFinance(setGoalAllocationSchema, input);
  const amount = decimalCents(payload.amount);
  return financeMutation(actor, request_id, "goal.allocate", { id, ...payload }, () => {
    const before = editableGoal(id, payload.version);
    const account = readAccountBalance(payload.account_id);
    const existing = before.allocations.find(row => row.account_id === account.id)?.amount_cents ?? 0;
    if (account.kind !== "money" || (account.archived && amount > existing)) throw new FinanceError("Choose an active money account; archived accounts only allow releases", 400, "invalid_account");
    if (amount > existing && BigInt(reservedAccountCents(account.id)) - BigInt(existing) + BigInt(amount) > BigInt(account.balance_cents)) {
      throw new FinanceError("Amount exceeds this account's unreserved money", 409, "allocation_limit");
    }
    if (!existing && amount > 0 && before.allocations.length >= 100) throw new FinanceError("A goal supports at most 100 account allocations", 400, "allocation_limit");
    exactCents(BigInt(before.saved_cents) - BigInt(existing) + BigInt(amount));
    const db = getDb();
    if (amount === 0) db.prepare("DELETE FROM finance_goal_allocations WHERE goal_id = ? AND account_id = ?").run(id, account.id);
    else db.prepare("INSERT INTO finance_goal_allocations (goal_id, account_id, amount_cents) VALUES (?,?,?) ON CONFLICT(goal_id, account_id) DO UPDATE SET amount_cents = excluded.amount_cents").run(id, account.id, amount);
    db.prepare("UPDATE finance_goals SET version = version + 1, updated_at = ? WHERE id = ?").run(now(), id);
    const after = readGoal(id), reservation = readReservationAccount(account.id);
    return { result: { goal: after, account: reservation, warnings: reservation.shortfall_cents > 0 ? ["allocation_shortfall"] : [] },
      affectedIds: [id, account.id], before, after };
  });
}
