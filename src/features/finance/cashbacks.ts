import { z } from "zod";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, createAccountSchema, getAccountSchema, type FinanceActor } from "./types";
import { calendarDateSchema } from "./activity-types";
import { insertTransaction, readTransaction } from "./activity";
import { financeMutation, parseFinance } from "./mutations";
import { readAccountBalance } from "./accounts";
import { decimalCents } from "./money";
import { localCalendarDate } from "./presentation";

export const cashbackActionSchema = z.object({
  request_id: createAccountSchema.shape.request_id,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
}).strict();
export const applyCashbackSchema = cashbackActionSchema.extend({
  transaction_date: calendarDateSchema,
  account_id: getAccountSchema.shape.id.optional(),
  amount: z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/).optional(),
});

export function applyCashback(actor: FinanceActor, id: string, input: unknown) {
  return changeCashback(actor, id, input, true);
}
export function unapplyCashback(actor: FinanceActor, id: string, input: unknown) {
  return changeCashback(actor, id, input, false);
}
function changeCashback(actor: FinanceActor, id: string, input: unknown, apply: boolean) {
  authorizeFinance(actor, "finance:write");
  parseFinance(getAccountSchema, { id });
  const payload = parseFinance(apply ? applyCashbackSchema : cashbackActionSchema, input);
  return financeMutation(actor, payload.request_id, apply ? "cashback.apply" : "cashback.unapply", { id, ...payload }, () => {
    const before = readTransaction(id, true);
    if (before.version !== payload.version || before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Activity changed; refresh before editing", 409, "version_conflict");
    if (before.reverted || before.type !== "expense" || !before.cashback_mode || !before.cashback_value) throw new FinanceError("Choose an active cashback expense", 409, "invalid_cashback");
    const db = getDb();
    const priorIncomes = (before.cashback_applications ?? []).map(entry => readTransaction(entry.id, true));
    let incomeId: string | null = null;
    let accountId = before.cashback_account_id ?? priorIncomes.at(-1)?.account_id ?? before.account_id;
    if (apply) {
      const credited = parseFinance(applyCashbackSchema, payload);
      if (credited.transaction_date > localCalendarDate()) throw new FinanceError("Cashback cannot be applied on a future date", 400, "future_date");
      if (credited.transaction_date < before.transaction_date) throw new FinanceError("Cashback cannot be credited before its purchase", 400, "invalid_date");
      const amount = credited.amount === undefined ? before.cashback_pending_cents ?? 0 : decimalCents(credited.amount);
      if (amount <= 0 || amount > (before.cashback_pending_cents ?? 0)) throw new FinanceError("Choose an amount within the remaining pending cashback", 409, "invalid_cashback");
      accountId = credited.account_id ?? accountId;
      const account = db.prepare("SELECT kind, archived FROM finance_accounts WHERE id=?").get(accountId) as { kind: string; archived: number } | undefined;
      if (!account || account.archived || !(account.kind === "money" || account.kind === "credit")) throw new FinanceError("Choose an active money or credit account for cashback", 400, "invalid_account");
      const category = db.prepare("SELECT id FROM finance_classifications WHERE kind='category' AND type='income' AND parent_id IS NULL AND archived=0 AND name=? COLLATE NOCASE ORDER BY id LIMIT 1").get("Cashback") as { id: string } | undefined;
      if (!category) throw new FinanceError("Create or restore an active income category named Cashback before applying cashback", 400, "invalid_category");
      incomeId = insertTransaction({ type: "income", account_id: accountId, amount_cents: amount, transaction_date: credited.transaction_date, category_id: category.id, subcategory_id: null, text: "Cashback", tag_ids: [] });
      db.prepare("INSERT INTO finance_cashback_applications (income_id,expense_id) VALUES (?,?)").run(incomeId, id);
      if (before.hidden) db.prepare("UPDATE finance_transactions SET hidden=1 WHERE id=?").run(incomeId);
    } else {
      if (!priorIncomes.length) throw new FinanceError("Cashback is already pending", 409, "invalid_cashback");
      for (const prior of priorIncomes) {
        if (prior.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Cashback income changed; refresh before editing", 409, "version_conflict");
        db.prepare("UPDATE finance_transactions SET reverted=1, version=version+1, updated_at=? WHERE id=?").run(now(), prior.id);
      }
    }
    db.prepare("UPDATE finance_cashbacks SET income_id=?, account_id=? WHERE expense_id=?").run(incomeId, accountId, id);
    db.prepare("UPDATE finance_transactions SET version=version+1, updated_at=? WHERE id=?").run(now(), id);
    const transaction = readTransaction(id, false);
    const result = { transaction, cashback: incomeId ? readTransaction(incomeId, false) : null, balance_cents: readAccountBalance(accountId).balance_cents };
    return { result, affectedIds: [id, accountId, ...priorIncomes.flatMap(entry => [entry.id, entry.account_id]), ...(incomeId ? [incomeId] : [])], before: { transaction: before, cashbacks: priorIncomes }, after: result };
  });
}
