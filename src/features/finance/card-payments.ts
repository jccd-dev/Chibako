import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { listAccounts, readAccountBalance } from "./accounts";
import { readTransaction } from "./activity";
import { applyCashback } from "./cashbacks";
import { getCreditCycles, readCreditCycles } from "./credit-cycles";
import { recordCardPaymentSchema } from "./credit-cycle-types";
import { decimalCents } from "./money";
import { postTransfer } from "./movements";
import { financeMutation, parseFinance } from "./mutations";
import { localCalendarDate } from "./presentation";
import { FinanceError, getAccountSchema, type FinanceActor } from "./types";
import type { FinanceAccount } from "./types";
import type { FinanceTransaction } from "./activity-types";
import type { FinanceCreditCycle } from "./credit-cycle-types";

export interface CardPaymentOptions {
  cycles: FinanceCreditCycle[];
  rewards: FinanceTransaction[];
  accounts: FinanceAccount[];
}

export interface RecordedCardPayment {
  account: FinanceAccount;
  payment: ReturnType<typeof postTransfer> | null;
  cashbacks: ReturnType<typeof applyCashback>[];
}

export function getCardPaymentOptions(actor: FinanceActor, id: string): CardPaymentOptions {
  const cycles = getCreditCycles(actor, id);
  const rows = getDb().prepare("SELECT expense_id FROM finance_cashbacks c JOIN finance_transactions t ON t.id=c.expense_id WHERE t.account_id=? AND t.reverted=0 AND t.transaction_date<=? ORDER BY t.transaction_date,t.id").all(id, localCalendarDate()) as { expense_id: string }[];
  const rewards = rows.map(row => readTransaction(row.expense_id, true)).filter(reward => (reward.cashback_pending_cents ?? 0) > 0);
  const accounts = [];
  let offset = 0;
  for (;;) {
    const page = listAccounts(actor, { kind: "money", limit: 100, offset });
    accounts.push(...page.accounts);
    offset += page.accounts.length;
    if (offset >= page.total) break;
  }
  return { cycles, rewards, accounts };
}

export function recordCardPayment(actor: FinanceActor, id: string, input: unknown): RecordedCardPayment {
  authorizeFinance(actor, "finance:write");
  parseFinance(getAccountSchema, { id });
  const { request_id, ...payload } = parseFinance(recordCardPaymentSchema, input);
  return financeMutation(actor, request_id, "card.payment", { id, ...payload }, () => {
    const before = readAccountBalance(id);
    if (before.kind !== "credit" || before.archived) throw new FinanceError("Choose an active credit account", 400, "invalid_account");
    if (before.version !== payload.version) throw new FinanceError("Account changed; refresh before paying", 409, "version_conflict");
    if (payload.transaction_date > localCalendarDate()) throw new FinanceError("Payment date cannot be in the future", 400, "invalid_date");
    if (!readCreditCycles(before).some(cycle => cycle.statement_date === payload.statement_date)) throw new FinanceError("Statement cycle changed; refresh before paying", 409, "version_conflict");
    const amount = decimalCents(payload.amount);
    if (amount === 0 && payload.cashbacks.length === 0) throw new FinanceError("Enter a payment or apply cashback", 400, "invalid_input");
    for (const reward of payload.cashbacks) {
      const expense = readTransaction(reward.expense_id, true);
      if (expense.account_id !== id) throw new FinanceError("Choose rewards earned on this card", 400, "invalid_cashback");
    }
    const cashbacks = payload.cashbacks.map(reward => applyCashback(actor, reward.expense_id, {
      request_id: randomUUID(), version: reward.version, amount: reward.amount, transaction_date: reward.transaction_date, account_id: id,
    }));
    if (amount > 0 && !payload.source_account_id) throw new FinanceError("Choose a payment account", 400, "invalid_account");
    const payment = amount > 0 ? postTransfer(actor, {
      request_id: randomUUID(), source_account_id: payload.source_account_id!, destination_account_id: id,
      amount: payload.amount, transaction_date: payload.transaction_date, text: `Card payment · cutoff ${payload.statement_date}`,
    }) : null;
    getDb().prepare("UPDATE finance_accounts SET version=version+1,updated_at=? WHERE id=?").run(now(), id);
    const result = { account: readAccountBalance(id), payment, cashbacks };
    return { result, affectedIds: [id, ...(payment ? [payment.transaction.id, payload.source_account_id!] : []), ...cashbacks.flatMap(item => [item.transaction.id, ...(item.cashback ? [item.cashback.id] : [])])], before, after: result };
  });
}
