import { getDb } from "../../lib/db";

interface LedgerEntry { date: string; value: string }
export type InterestLedgerSnapshot = Record<string, LedgerEntry>;
type DatedRow = { id: string; effective_date: string; [key: string]: unknown };

/** Compare dated cash sources so new activity cannot starve a bounded historical scan. */
export function interestLedgerSnapshot(accountId: string): InterestLedgerSnapshot {
  const db = getDb(), snapshot: InterestLedgerSnapshot = {};
  const add = (prefix: string, rows: DatedRow[]) => {
    for (const row of rows) snapshot[`${prefix}:${row.id}`] = { date: row.effective_date, value: JSON.stringify(row) };
  };
  const account = db.prepare("SELECT kind,opening_balance_cents,maintaining_balance_cents,created_at FROM finance_accounts WHERE id=?").get(accountId) as { kind: string; opening_balance_cents: number; maintaining_balance_cents: number; created_at: number };
  let maintaining = BigInt(account.maintaining_balance_cents);
  const audits = db.prepare(`SELECT id,date(created_at,'unixepoch','+8 hours') AS effective_date,
    COALESCE(json_extract(before_json,'$.maintaining_balance_cents'),0) AS before_cents,
    COALESCE(json_extract(after_json,'$.maintaining_balance_cents'),0) AS after_cents
    FROM finance_audit WHERE operation='account.update' AND json_extract(before_json,'$.id')=? ORDER BY id`).all(accountId) as { id: string; effective_date: string; before_cents: number; after_cents: number }[];
  for (const audit of audits) {
    if (!Number.isSafeInteger(audit.before_cents) || !Number.isSafeInteger(audit.after_cents)) throw new Error("Invalid maintaining-balance audit history");
    const delta = BigInt(audit.after_cents) - BigInt(audit.before_cents);
    maintaining -= delta;
    if (delta) snapshot[`maintaining:${audit.id}`] = { date: audit.effective_date, value: String(delta) };
  }
  snapshot.account = { date: new Date((account.created_at + 8 * 3600) * 1000).toISOString().slice(0, 10), value: JSON.stringify({ kind: account.kind, opening: account.opening_balance_cents, maintaining: String(maintaining), created_at: account.created_at }) };
  add("configuration", db.prepare("SELECT *,start_date AS effective_date FROM finance_interest_configurations WHERE account_id=? ORDER BY id").all(accountId) as DatedRow[]);
  add("transaction", db.prepare("SELECT id,transaction_date AS effective_date,type,amount_cents,reverted FROM finance_transactions WHERE account_id=? ORDER BY id").all(accountId) as DatedRow[]);
  add("movement", db.prepare("SELECT id,transaction_date AS effective_date,type,account_id,destination_account_id,amount_cents,reverted FROM finance_movements WHERE account_id=? OR destination_account_id=? ORDER BY id").all(accountId, accountId) as DatedRow[]);
  add("refund", db.prepare("SELECT id,transaction_date AS effective_date,amount_cents,reverted FROM finance_refunds WHERE account_id=? ORDER BY id").all(accountId) as DatedRow[]);
  add("principal", db.prepare("SELECT id,transaction_date AS effective_date,type,amount_cents,reverted FROM finance_obligation_movements WHERE account_id=? ORDER BY id").all(accountId) as DatedRow[]);
  add("goal", db.prepare("SELECT id,date(created_at,'unixepoch','+8 hours') AS effective_date,source_account_id,destination_account_id,amount_cents FROM finance_goal_movements WHERE source_account_id=? OR destination_account_id=? ORDER BY id").all(accountId, accountId) as DatedRow[]);
  add("adjustment", db.prepare("SELECT id,transaction_date AS effective_date,amount_cents FROM finance_interest_adjustments WHERE account_id=? ORDER BY id").all(accountId) as DatedRow[]);
  return snapshot;
}

export function earliestInterestChange(before: InterestLedgerSnapshot, after: InterestLedgerSnapshot): string | null {
  let earliest: string | null = null;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[key], current = after[key];
    if (old?.date === current?.date && old?.value === current?.value) continue;
    for (const entry of [old, current]) if (entry && (earliest === null || entry.date < earliest)) earliest = entry.date;
  }
  return earliest;
}
