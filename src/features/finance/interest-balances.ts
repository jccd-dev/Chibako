import { getDb } from "../../lib/db";
import { exactCents } from "./money";
import { interestDate } from "./interest-calculation";
import { FinanceError } from "./types";

function phDate(seconds: number): string {
  return new Date((seconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

function maintainingCents(value: object): bigint {
  // Audits from before maintaining balances existed represent zero maintaining money.
  if (!("maintaining_balance_cents" in value)) return 0n;
  const cents = value.maintaining_balance_cents;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid maintaining-balance audit history");
  return BigInt(cents);
}

/** Internal cash projection; callers own authorization. Hidden cash still earns interest. */
export function readInterestClosingBalance(accountId: string, day: string): number {
  interestDate(day);
  const db = getDb();
  return db.transaction(() => {
    const account = db.prepare("SELECT kind, opening_balance_cents, maintaining_balance_cents, created_at FROM finance_accounts WHERE id=?").get(accountId) as { kind: string; opening_balance_cents: number; maintaining_balance_cents: number; created_at: number } | undefined;
    if (!account) throw new FinanceError("Account not found", 404, "not_found");
    if (account.kind !== "money") throw new FinanceError("Interest requires a money account", 400, "invalid_input");
    if (day < phDate(account.created_at)) return 0;
    let balance = BigInt(account.opening_balance_cents) + BigInt(account.maintaining_balance_cents);
    // Reverse only later maintaining edits: today's setting is not historical cash.
    // Runs once per accrued day, so narrow in SQL; a missing field counts as zero, matching maintainingCents.
    const audits = db.prepare(`SELECT before_json, after_json FROM finance_audit WHERE operation='account.update'
      AND json_extract(before_json,'$.id')=? AND date(created_at,'unixepoch','+8 hours')>?
      AND COALESCE(json_extract(before_json,'$.maintaining_balance_cents'),0) IS NOT COALESCE(json_extract(after_json,'$.maintaining_balance_cents'),0)`)
      .all(accountId, day) as { before_json: string; after_json: string }[];
    for (const audit of audits) {
      const before: object = JSON.parse(audit.before_json), after: unknown = JSON.parse(audit.after_json);
      if (!after || typeof after !== "object" || !("id" in after) || after.id !== accountId) throw new Error("Invalid maintaining-balance audit history");
      balance -= maintainingCents(after) - maintainingCents(before);
    }
    const effects = db.prepare(`SELECT effective_date, cents FROM (
      SELECT transaction_date AS effective_date, CASE WHEN type='income' THEN amount_cents ELSE -amount_cents END AS cents
        FROM finance_transactions WHERE account_id=@id AND reverted=0
      UNION ALL SELECT transaction_date, CASE WHEN type='transfer' AND account_id=@id THEN -amount_cents ELSE amount_cents END
        FROM finance_movements WHERE (account_id=@id OR destination_account_id=@id) AND reverted=0
      UNION ALL SELECT transaction_date, amount_cents FROM finance_refunds WHERE account_id=@id AND reverted=0
      UNION ALL SELECT transaction_date, CASE WHEN type='borrowing' THEN amount_cents ELSE -amount_cents END
        FROM finance_obligation_movements WHERE account_id=@id AND reverted=0
      UNION ALL SELECT date(created_at, 'unixepoch', '+8 hours'),
        CASE WHEN destination_account_id=@id THEN amount_cents ELSE 0 END - CASE WHEN source_account_id=@id THEN amount_cents ELSE 0 END
        FROM finance_goal_movements WHERE source_account_id=@id OR destination_account_id=@id
      UNION ALL SELECT transaction_date, amount_cents FROM finance_interest_adjustments WHERE account_id=@id
    ) WHERE effective_date <= @day`).safeIntegers().iterate({ id: accountId, day }) as Iterable<{ cents: bigint }>;
    for (const effect of effects) balance += effect.cents;
    return exactCents(balance);
  })();
}
