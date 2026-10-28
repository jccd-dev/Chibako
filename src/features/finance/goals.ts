import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { parseFinance, financeMutation } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { readAccountBalance, listAccounts, requireSufficientFunds } from "./accounts";
import { reservedAccountCents, reservationAmounts } from "./reservations";
import { FinanceError, type FinanceActor } from "./types";
import { createGoalSchema, updateGoalSchema, listGoalsSchema, getGoalSchema, listGoalAccountsSchema, setGoalAllocationSchema, deleteGoalSchema, moveGoalMoneySchema, type FinanceGoal, type FinanceGoalList, type FinanceReservationAccount } from "./goal-types";

type GoalRow = Omit<FinanceGoal, "archived" | "allocations" | "achieved" | "linked_account_name"> & { archived: number };

function goalFromRow(row: GoalRow): FinanceGoal {
  const rows = getDb().prepare("SELECT account_id, amount_cents FROM finance_goal_allocations WHERE goal_id = ? ORDER BY account_id")
    .all(row.id) as { account_id: string; amount_cents: number }[];
  const allocations = rows.map(allocation => ({ ...readReservationAccount(allocation.account_id), amount_cents: allocation.amount_cents }));
  const saved_cents = exactCents(allocations.reduce((sum, allocation) => sum + BigInt(allocation.amount_cents), 0n));
  return { ...row, saved_cents, achieved: saved_cents >= row.target_cents, allocations,
    linked_account_id: row.linked_account_id ?? null,
    linked_account_name: row.linked_account_id ? readAccountBalance(row.linked_account_id).name : null,
    due_date: row.due_date ?? null, archived: row.archived === 1, currency: "PHP" };
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

export function listGoalAllocationShortfalls(actor: FinanceActor, input: { limit: number }) {
  authorizeFinance(actor, "finance:read");
  const balanceSql = `(
    a.opening_balance_cents + a.maintaining_balance_cents
    + COALESCE((SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount_cents ELSE -t.amount_cents END)
      FROM finance_transactions t WHERE t.account_id = a.id AND t.reverted = 0), 0)
    + COALESCE((SELECT SUM(CASE WHEN m.type = 'transfer' AND m.account_id = a.id THEN -m.amount_cents ELSE m.amount_cents END)
      FROM finance_movements m WHERE m.reverted = 0 AND (m.account_id = a.id OR m.destination_account_id = a.id)), 0)
    + COALESCE((SELECT SUM(r.amount_cents) FROM finance_refunds r WHERE r.account_id = a.id AND r.reverted = 0), 0)
    + COALESCE((SELECT SUM(CASE WHEN m.type = 'borrowing' THEN m.amount_cents ELSE -m.amount_cents END)
      FROM finance_obligation_movements m WHERE m.account_id = a.id AND m.reverted = 0), 0)
    + COALESCE((SELECT SUM(m.amount_cents) FROM finance_goal_movements m WHERE m.destination_account_id = a.id), 0)
    - COALESCE((SELECT SUM(m.amount_cents) FROM finance_goal_movements m WHERE m.source_account_id = a.id), 0)
  )`;
  const reservedSql = `(SELECT COALESCE(SUM(ga.amount_cents), 0) FROM finance_goal_allocations ga
    JOIN finance_goals g ON g.id = ga.goal_id AND g.archived = 0 WHERE g.linked_account_id = a.id)`;
  const cte = `WITH account_reservations AS (
    SELECT a.id AS account_id, a.created_at, ${balanceSql} AS balance_cents, ${reservedSql} AS reserved_cents
    FROM finance_accounts a WHERE a.kind = 'money'
  ), shortfalls AS (
    SELECT account_id, balance_cents, reserved_cents,
      reserved_cents - CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END AS shortfall_cents
    FROM account_reservations
    WHERE reserved_cents > CASE WHEN balance_cents > 0 THEN balance_cents ELSE 0 END
  )`;
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`${cte} SELECT COUNT(*) AS total FROM shortfalls`).get() as { total: number };
    const rows = db.prepare(`${cte} SELECT account_id, balance_cents, reserved_cents, shortfall_cents FROM shortfalls
      ORDER BY account_id LIMIT ?`).safeIntegers().all(input.limit) as { account_id: string; balance_cents: bigint; reserved_cents: bigint; shortfall_cents: bigint }[];
    return {
      accounts: rows.map(row => ({ account_id: row.account_id, balance_cents: exactCents(row.balance_cents), reserved_cents: exactCents(row.reserved_cents), shortfall_cents: exactCents(row.shortfall_cents) })),
      total,
    };
  })();
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

function mutateGoal(actor: FinanceActor, requestId: string, operation: string, payload: object, change: () => { before: FinanceGoal | null; after: FinanceGoal }, accounts: string[] = []): { goal: FinanceGoal } {
  return financeMutation(actor, requestId, operation, payload, () => {
    const { before, after } = change();
    return { result: { goal: after }, affectedIds: [...new Set([after.id, ...accounts, ...after.allocations.map(row => row.account_id),
      ...(before?.linked_account_id ? [before.linked_account_id] : []), ...(after.linked_account_id ? [after.linked_account_id] : [])])], before, after };
  });
}

export function createGoal(actor: FinanceActor, input: unknown): { goal: FinanceGoal } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(createGoalSchema, input);
  const targetCents = decimalCents(payload.target);
  if (targetCents <= 0) throw new FinanceError("Use a target above PHP 0.00", 400, "invalid_input");
  return mutateGoal(actor, request_id, "goal.create", payload, () => {
    const linked = payload.linked_account_id ? activeMoneyAccount(payload.linked_account_id) : null;
    const initialCents = linked ? Math.max(0, linked.balance_cents) : 0;
    if (linked && initialCents > 0) {
      requireSufficientFunds(BigInt(linked.balance_cents) - BigInt(reservedAccountCents(linked.id)), initialCents);
    }
    const id = randomUUID();
    const timestamp = now();
    getDb().prepare("INSERT INTO finance_goals (id, name, target_cents, saved_cents, due_date, linked_account_id, archived, version, created_at, updated_at) VALUES (?,?,?,?,?,?,0,1,?,?)")
      .run(id, payload.name, targetCents, 0, payload.due_date ?? null, payload.linked_account_id ?? null, timestamp, timestamp);
    if (linked && initialCents > 0) writeAllocation(id, linked.id, initialCents);
    return { before: null, after: readGoal(id) };
  });
}

export function updateGoal(actor: FinanceActor, id: string, input: unknown): { goal: FinanceGoal } {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getGoalSchema, { id });
  const { request_id, ...patch } = parseFinance(updateGoalSchema, input);
  if (patch.linked_account_id !== undefined) authorizeFinance(actor, "finance:write");
  const targetCents = patch.target === undefined ? null : decimalCents(patch.target);
  if (targetCents !== null && targetCents <= 0) throw new FinanceError("Use a target above PHP 0.00", 400, "invalid_input");
  return mutateGoal(actor, request_id, "goal.update", { id, ...patch }, () => {
    const before = editableGoal(id, patch.version);
    if (patch.archived && before.saved_cents > 0) throw new FinanceError("Withdraw all goal money before archiving", 409, "goal_has_money");
    const assignments: string[] = [], values: (string | number | null)[] = [];
    if (patch.name !== undefined) { assignments.push("name = ?"); values.push(patch.name); }
    if (targetCents !== null) { assignments.push("target_cents = ?"); values.push(targetCents); }
    if (patch.due_date !== undefined) { assignments.push("due_date = ?"); values.push(patch.due_date ?? null); }
    if (patch.archived !== undefined) { assignments.push("archived = ?"); values.push(patch.archived ? 1 : 0); }
    if (patch.linked_account_id !== undefined) {
      const linked = patch.linked_account_id;
      if (linked !== before.linked_account_id) {
        if (linked) activeMoneyAccount(linked);
        if (before.saved_cents > 0) {
          recordGoalMovement(before, "relocation", before.linked_account_id, linked, before.saved_cents);
        }
      }
      assignments.push("linked_account_id = ?"); values.push(linked);
    }
    getDb().prepare(`UPDATE finance_goals SET ${assignments.join(", ")}, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(...values, now(), id);
    return { before, after: readGoal(id) };
  });
}

function activeMoneyAccount(id: string) {
  const account = readAccountBalance(id);
  if (account.kind !== "money" || account.archived) throw new FinanceError("Choose an active money account", 400, "invalid_account");
  return account;
}

function recordGoalMovement(goal: FinanceGoal, type: "deposit" | "withdrawal" | "relocation", sourceId: string | null, destinationId: string | null, amount: number) {
  if (type === "withdrawal" && sourceId !== null && sourceId === destinationId) {
    throw new FinanceError("Choose a destination different from the goal's linked account", 400, "invalid_account");
  }
  if (sourceId !== destinationId) {
    if (sourceId) {
      const source = readAccountBalance(sourceId);
      const ownHolding = sourceId === goal.linked_account_id ? goal.saved_cents : 0;
      requireSufficientFunds(BigInt(source.balance_cents) - BigInt(reservedAccountCents(sourceId)) + BigInt(ownHolding), amount);
      exactCents(BigInt(source.balance_cents) - BigInt(amount));
    }
    if (destinationId) exactCents(BigInt(activeMoneyAccount(destinationId).balance_cents) + BigInt(amount));
  }
  getDb().prepare(`INSERT INTO finance_goal_movements (id, goal_id, type, source_account_id, destination_account_id, amount_cents, created_at)
    VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), goal.id, type, sourceId, destinationId, amount, now());
}

function writeAllocation(goalId: string, accountId: string, amount: number) {
  const db = getDb();
  if (amount === 0) db.prepare("DELETE FROM finance_goal_allocations WHERE goal_id = ? AND account_id = ?").run(goalId, accountId);
  else db.prepare(`INSERT INTO finance_goal_allocations (goal_id, account_id, amount_cents) VALUES (?,?,?)
    ON CONFLICT(goal_id, account_id) DO UPDATE SET amount_cents = excluded.amount_cents`).run(goalId, accountId, amount);
}

function depositGoalMoney(goal: FinanceGoal, accountId: string, amount: number) {
  activeMoneyAccount(accountId);
  if (accountId === goal.linked_account_id) throw new FinanceError("Choose a source different from the goal's linked account", 400, "invalid_account");
  const existing = goal.allocations.find(row => row.account_id === accountId)?.amount_cents ?? 0;
  if (!existing && goal.allocations.length >= 100) throw new FinanceError("A goal supports at most 100 funding accounts", 400, "allocation_limit");
  exactCents(BigInt(goal.saved_cents) + BigInt(amount));
  recordGoalMovement(goal, "deposit", accountId, goal.linked_account_id, amount);
  writeAllocation(goal.id, accountId, exactCents(BigInt(existing) + BigInt(amount)));
}

export function moveGoalMoney(actor: FinanceActor, id: string, input: unknown): { goal: FinanceGoal } {
  authorizeFinance(actor, "finance:manage");
  authorizeFinance(actor, "finance:write");
  parseFinance(getGoalSchema, { id });
  const { request_id, ...payload } = parseFinance(moveGoalMoneySchema, input);
  const amount = decimalCents(payload.amount);
  if (amount <= 0) throw new FinanceError("Use an amount above PHP 0.00", 400, "invalid_input");
  return mutateGoal(actor, request_id, "goal.move", { id, ...payload }, () => {
    const before = editableGoal(id, payload.version);
    if (payload.direction === "deposit") depositGoalMoney(before, payload.account_id, amount);
    else {
      activeMoneyAccount(payload.account_id);
      if (amount > before.saved_cents) throw new FinanceError("Amount exceeds the money in this goal", 409, "insufficient_funds");
      recordGoalMovement(before, "withdrawal", before.linked_account_id, payload.account_id, amount);
      let remaining = amount;
      for (const allocation of before.allocations) {
        const released = Math.min(remaining, allocation.amount_cents);
        writeAllocation(id, allocation.account_id, allocation.amount_cents - released);
        remaining -= released;
        if (remaining === 0) break;
      }
    }
    getDb().prepare("UPDATE finance_goals SET version = version + 1, updated_at = ? WHERE id = ?").run(now(), id);
    return { before, after: readGoal(id) };
  }, [payload.account_id]);
}

// Keep the absolute per-source contract for existing REST and MCP callers.
export function setGoalAllocation(actor: FinanceActor, id: string, input: unknown) {
  authorizeFinance(actor, "finance:manage");
  authorizeFinance(actor, "finance:write");
  parseFinance(getGoalSchema, { id });
  const { request_id, ...payload } = parseFinance(setGoalAllocationSchema, input);
  const amount = decimalCents(payload.amount);
  return financeMutation(actor, request_id, "goal.allocate", { id, ...payload }, () => {
    const before = editableGoal(id, payload.version);
    const existing = before.allocations.find(row => row.account_id === payload.account_id)?.amount_cents ?? 0;
    const difference = amount - existing;
    if (difference > 0) depositGoalMoney(before, payload.account_id, difference);
    if (difference < 0) {
      activeMoneyAccount(payload.account_id);
      recordGoalMovement(before, "withdrawal", before.linked_account_id, payload.account_id, -difference);
      writeAllocation(id, payload.account_id, amount);
    }
    getDb().prepare("UPDATE finance_goals SET version = version + 1, updated_at = ? WHERE id = ?").run(now(), id);
    const after = readGoal(id), account = readReservationAccount(payload.account_id);
    return { result: { goal: after, account, warnings: [] },
      affectedIds: [...new Set([id, payload.account_id, ...(before.linked_account_id ? [before.linked_account_id] : [])])], before, after };
  });
}

// Removes a mistaken goal for good. Refused when its movements left any account changed, so balances never change;
// linked-account reservations without movements are simply released.
export function deleteGoal(actor: FinanceActor, id: string, input: unknown): { deleted: true; id: string } {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getGoalSchema, { id });
  const payload = parseFinance(deleteGoalSchema, input);
  return financeMutation(actor, payload.request_id, "goal.delete", { id, version: payload.version }, () => {
    const before = readGoal(id), db = getDb();
    if (payload.version !== before.version) throw new FinanceError("Goal changed; refresh before editing", 409, "version_conflict");
    const movements = db.prepare("SELECT * FROM finance_goal_movements WHERE goal_id = ?").all(id) as Array<{ source_account_id: string | null; destination_account_id: string | null; amount_cents: number }>;
    const net = new Map<string, bigint>();
    for (const row of movements) {
      if (row.source_account_id === row.destination_account_id) continue;
      if (row.source_account_id) net.set(row.source_account_id, (net.get(row.source_account_id) ?? 0n) - BigInt(row.amount_cents));
      if (row.destination_account_id) net.set(row.destination_account_id, (net.get(row.destination_account_id) ?? 0n) + BigInt(row.amount_cents));
    }
    if ([...net.values()].some(cents => cents !== 0n)) {
      throw new FinanceError("This goal moved money between accounts. Return it to the account it came from, or archive the goal instead", 409, "has_cash_activity");
    }
    db.prepare("DELETE FROM finance_goal_allocations WHERE goal_id = ?").run(id);
    db.prepare("DELETE FROM finance_goal_movements WHERE goal_id = ?").run(id);
    db.prepare("DELETE FROM finance_goals WHERE id = ?").run(id);
    return { result: { deleted: true, id }, affectedIds: [id, ...net.keys()], before: { goal: before, movements }, after: null };
  });
}
