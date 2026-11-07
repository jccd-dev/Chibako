import { randomUUID } from "node:crypto";
import { getDb, MaintenanceError, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { insertTransaction } from "./activity";
import { readAccountBalance } from "./accounts";
import { readInterestClosingBalance } from "./interest-balances";
import { calculateInterest, interestCalendarDate, interestPayoutDate, interestPercentText, type InterestFrequency } from "./interest-calculation";
import { earliestInterestChange, interestLedgerSnapshot, type InterestLedgerSnapshot } from "./interest-ledger-state";
import { exactCents } from "./money";
import { financeMutation, parseFinance } from "./mutations";
import { financeBalanceWarnings } from "./reservations";
import { FinanceError, getAccountSchema, type FinanceActor } from "./types";

interface Configuration {
  id: string; account_id: string; start_date: string; end_date: string | null;
  annual_rate_scaled: number; tax_scaled: number; frequency: InterestFrequency;
  actor_id: string; request_id: string;
}
interface Cursor { cursor_date: string }
interface Period { id: string; amount_cents: number; payout_transaction_id: string | null }

const actor: FinanceActor = { kind: "trusted-local" };
const PERIOD_LIMIT = 100;
const ACCOUNT_LIMIT = 20;
let accountCursor = "";

function accrue(config: Configuration, start: string, end: string, today: string, carry: bigint) {
  return calculateInterest({ start_date: start, end_date: end, through_date: today,
    annual_rate: interestPercentText(config.annual_rate_scaled), withholding_tax: interestPercentText(config.tax_scaled),
    carry, closingBalance: day => readInterestClosingBalance(config.account_id, day) });
}

function interestCategory(accountId: string): string | null {
  const db = getDb();
  const state = db.prepare("SELECT category_id,category_initialized FROM finance_interest_state WHERE account_id=?").get(accountId) as { category_id: string | null; category_initialized: number };
  if (!state.category_initialized) {
    const existing = db.prepare("SELECT id FROM finance_classifications WHERE kind='category' AND type='income' AND parent_id IS NULL AND archived=0 AND name='Interest' COLLATE NOCASE ORDER BY id LIMIT 1").get() as { id: string } | undefined;
    state.category_id = existing?.id ?? randomUUID();
    if (!existing) db.prepare("INSERT INTO finance_classifications(id,kind,type,name,created_at,updated_at) VALUES (?,'category','income','Interest',?,?)").run(state.category_id, now(), now());
    db.prepare("UPDATE finance_interest_state SET category_id=?,category_initialized=1 WHERE account_id=?").run(state.category_id, accountId);
  }
  return db.prepare("SELECT id FROM finance_classifications WHERE id=? AND archived=0 AND kind='category' AND type='income' AND parent_id IS NULL").get(state.category_id) ? state.category_id : null;
}

function duePeriod(config: Configuration, cursor: Cursor, today: string) {
  const start = cursor.cursor_date;
  if (config.end_date !== null && start >= config.end_date) return null;
  const payout = interestPayoutDate(start, config.frequency);
  if (payout > today) return null;
  const end = config.end_date !== null && config.end_date < payout ? config.end_date : payout;
  return { config, cursor, start, end, payout };
}

function processAccount(accountId: string, today: string) {
  const db = getDb();
  return db.transaction(() => {
    const account = readAccountBalance(accountId);
    if (account.kind !== "money") throw new FinanceError("Automatic interest requires a PHP money account", 400, "invalid_account");
    const configurations = db.prepare("SELECT * FROM finance_interest_configurations WHERE account_id=? ORDER BY start_date,id").all(accountId) as Configuration[];
    const state = db.prepare("SELECT source_snapshot,carry_numerator,processed_payout_date FROM finance_interest_state WHERE account_id=?").get(accountId) as { source_snapshot: string | null; carry_numerator: string; processed_payout_date: string | null };
    // Snapshot JSON is written only here, under this storage contract.
    const previousSnapshot = state.source_snapshot ? JSON.parse(state.source_snapshot) as InterestLedgerSnapshot : {};
    const changedDay = earliestInterestChange(previousSnapshot, interestLedgerSnapshot(accountId));
    let carry = BigInt(state.carry_numerator);
    let processedPayout = state.processed_payout_date;
    if (changedDay !== null) {
      const affectedPayouts = configurations.flatMap(config => {
        const day = changedDay > config.start_date ? changedDay : config.start_date;
        return config.end_date !== null && day >= config.end_date ? [] : [interestPayoutDate(day, config.frequency)];
      }).sort();
      const resetAt = affectedPayouts[0];
      if (resetAt && processedPayout !== null && resetAt <= processedPayout) {
        // Earlier payout carry remains valid; recalculate the first affected payout and everything after it.
        for (const config of configurations) {
          const prior = db.prepare("SELECT end_date FROM finance_interest_periods WHERE configuration_id=? AND payout_date<? ORDER BY payout_date DESC,start_date DESC LIMIT 1").get(config.id, resetAt) as { end_date: string } | undefined;
          db.prepare("INSERT INTO finance_interest_cursors(configuration_id,cursor_date) VALUES (?,?) ON CONFLICT(configuration_id) DO UPDATE SET cursor_date=excluded.cursor_date")
            .run(config.id, prior?.end_date ?? config.start_date);
        }
        const priorCarry = db.prepare(`SELECT p.carry_numerator,p.payout_date FROM finance_interest_periods p JOIN finance_interest_configurations c ON c.id=p.configuration_id
          WHERE p.account_id=? AND p.payout_date<? ORDER BY p.payout_date DESC,p.start_date DESC,c.id DESC LIMIT 1`).get(accountId, resetAt) as { carry_numerator: string; payout_date: string } | undefined;
        carry = BigInt(priorCarry?.carry_numerator ?? "0");
        processedPayout = priorCarry?.payout_date ?? null;
      }
    }
    const cursors = new Map(configurations.map(config => [config.id,
      (db.prepare("SELECT cursor_date FROM finance_interest_cursors WHERE configuration_id=?").get(config.id) as Cursor | undefined)
      ?? { cursor_date: config.start_date }]));
    let posted_count = 0, adjusted_count = 0;
    const next = () => configurations.flatMap(config => {
      const period = duePeriod(config, cursors.get(config.id)!, today);
      return period ? [period] : [];
    }).sort((a, b) => a.payout.localeCompare(b.payout) || a.start.localeCompare(b.start) || a.config.id.localeCompare(b.config.id))[0];
    for (let count = 0; count < PERIOD_LIMIT; count++) {
      const due = next();
      if (!due) break;
      const { config, cursor, start, end, payout } = due;
      const computed = accrue(config, start, end, today, carry);
      const previous = db.prepare("SELECT id,amount_cents,payout_transaction_id FROM finance_interest_periods WHERE configuration_id=? AND start_date=? AND end_date=?").get(config.id, start, end) as Period | undefined;
      const periodId = previous?.id ?? randomUUID();
      const corrections = db.prepare("SELECT amount_cents FROM finance_interest_adjustments WHERE period_id=?").safeIntegers().all(periodId) as { amount_cents: bigint }[];
      const credited = BigInt(previous?.amount_cents ?? 0) + corrections.reduce((sum, row) => sum + row.amount_cents, 0n);
      const difference = exactCents(BigInt(computed.amount_cents) - credited);
      if (!previous || difference !== 0) {
        financeMutation(actor, randomUUID(), previous ? "interest.adjust" : "interest.payout", { configuration_id: config.id, period_id: periodId, processing_date: today }, () => {
          const category = interestCategory(accountId);
          let transactionId: string | null = null, adjustmentId: string | null = null;
          if (!previous) {
            if (computed.amount_cents > 0) transactionId = insertTransaction({ type: "income", account_id: accountId, amount_cents: computed.amount_cents,
              transaction_date: payout, category_id: category, subcategory_id: null, text: "Interest", tag_ids: [] });
            db.prepare("INSERT INTO finance_interest_periods(id,account_id,configuration_id,start_date,end_date,payout_date,payout_transaction_id,amount_cents,carry_numerator,processed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
              .run(periodId, accountId, config.id, start, end, payout, transactionId, computed.amount_cents, String(computed.carry), now());
            posted_count += Number(transactionId !== null);
          } else {
            adjustmentId = randomUUID();
            db.prepare("INSERT INTO finance_interest_adjustments(id,period_id,account_id,amount_cents,transaction_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
              .run(adjustmentId, periodId, accountId, difference, today, now(), now());
            adjusted_count++;
          }
          const balance = readAccountBalance(accountId).balance_cents;
          const warnings = financeBalanceWarnings([{ account_id: accountId, balance_cents: balance }]);
          const result = { period_id: periodId, transaction_id: transactionId, adjustment_id: adjustmentId, amount_cents: difference, balance_cents: balance, ...warnings };
          return { result, affectedIds: [accountId, periodId, ...[transactionId, adjustmentId].filter((id): id is string => id !== null)], before: previous ?? null,
            after: { ...result, configuration: config, start_date: start, end_date: end, payout_date: payout, carry_numerator: String(computed.carry) } };
        });
      }
      cursor.cursor_date = end;
      carry = computed.carry;
      processedPayout = payout;
      db.prepare("UPDATE finance_interest_periods SET carry_numerator=? WHERE id=?").run(String(carry), periodId);
      db.prepare("INSERT INTO finance_interest_cursors(configuration_id,cursor_date) VALUES (?,?) ON CONFLICT(configuration_id) DO UPDATE SET cursor_date=excluded.cursor_date")
        .run(config.id, end);
    }
    db.prepare("UPDATE finance_interest_state SET source_snapshot=?,carry_numerator=?,processed_payout_date=?,automatic_error=NULL WHERE account_id=?").run(JSON.stringify(interestLedgerSnapshot(accountId)), String(carry), processedPayout, accountId);
    return { posted_count, adjusted_count, has_more: !!next() };
  }).immediate();
}

/** Server-only worker, intentionally absent from REST/MCP registration. */
export function processAutomaticInterest(at = new Date()) {
  const today = interestCalendarDate(at), db = getDb();
  const accounts = db.prepare("SELECT DISTINCT account_id FROM finance_interest_configurations WHERE account_id>? ORDER BY account_id LIMIT ?").all(accountCursor, ACCOUNT_LIMIT) as { account_id: string }[];
  accountCursor = accounts.length === ACCOUNT_LIMIT ? accounts[accounts.length - 1].account_id : "";
  let posted_count = 0, adjusted_count = 0, failed_count = 0, has_more = accounts.length === ACCOUNT_LIMIT;
  for (const { account_id } of accounts) {
    db.prepare("INSERT OR IGNORE INTO finance_interest_state(account_id) VALUES (?)").run(account_id);
    try {
      const result = processAccount(account_id, today);
      posted_count += result.posted_count; adjusted_count += result.adjusted_count; has_more ||= result.has_more;
    } catch (error) {
      if (error instanceof MaintenanceError) throw error;
      const message = error instanceof FinanceError ? error.message : "Automatic interest failed. Review this account's dated cash history and interest settings.";
      db.prepare("UPDATE finance_interest_state SET automatic_error=? WHERE account_id=?").run(message.slice(0, 300), account_id);
      failed_count++;
    }
  }
  return { posted_count, adjusted_count, failed_count, has_more };
}

/** Unposted net accrual through yesterday, including anything the worker has not reached yet. */
export function getInterestProcessingStatus(actor: FinanceActor, accountId: string, at = new Date()) {
  authorizeFinance(actor, "finance:read");
  parseFinance(getAccountSchema, { id: accountId });
  const db = getDb(), today = interestCalendarDate(at);
  return db.transaction(() => {
    readAccountBalance(accountId);
    const state = db.prepare("SELECT automatic_error,carry_numerator FROM finance_interest_state WHERE account_id=?").get(accountId) as { automatic_error: string | null; carry_numerator: string } | undefined;
    const configurations = db.prepare("SELECT * FROM finance_interest_configurations WHERE account_id=? ORDER BY start_date,id").all(accountId) as Configuration[];
    let carry = BigInt(state?.carry_numerator ?? "0"), accrued = 0n, nextPayout: string | null = null;
    try {
      for (const config of configurations) {
        const cursor = db.prepare("SELECT cursor_date FROM finance_interest_cursors WHERE configuration_id=?").get(config.id) as Cursor | undefined;
        let start = cursor?.cursor_date ?? config.start_date;
        while (config.end_date === null || start < config.end_date) {
          const payout = interestPayoutDate(start, config.frequency);
          if (nextPayout === null || payout < nextPayout) nextPayout = payout;
          const end = config.end_date !== null && config.end_date < payout ? config.end_date : payout;
          const computed = accrue(config, start, end, today, carry);
          accrued += BigInt(computed.amount_cents);
          carry = computed.carry;
          if (end >= today) break;
          start = end;
        }
      }
      return { automatic_error: state?.automatic_error ?? null, accrued_cents: exactCents(accrued), next_payout_date: nextPayout };
    } catch (error) {
      // An account the worker cannot calculate must still report why.
      if (!(error instanceof FinanceError)) throw error;
      return { automatic_error: state?.automatic_error ?? error.message, accrued_cents: 0, next_payout_date: nextPayout };
    }
  })();
}
