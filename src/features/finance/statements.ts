import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, getAccountSchema, type FinanceActor } from "./types";
import { confirmStatementSchema } from "./statement-types";
import { readAccountBalance } from "./accounts";
import { decimalCents } from "./money";
import { financeMutation, parseFinance } from "./mutations";
import { nominalClose } from "./credit-cycles";


export function confirmStatement(actor: FinanceActor, id: string, input: unknown) {
  authorizeFinance(actor, "finance:write");
  parseFinance(getAccountSchema, { id });
  const { request_id, ...payload } = parseFinance(confirmStatementSchema, input);
  const balance = decimalCents(payload.balance), minimum = decimalCents(payload.minimum_due);
  if (minimum > balance) throw new FinanceError("Minimum due cannot exceed the statement balance", 400, "invalid_statement");
  return financeMutation(actor, request_id, "statement.confirm", { id, ...payload }, () => {
    const before = readAccountBalance(id);
    if (before.version !== payload.version) throw new FinanceError("Account changed; refresh before editing", 409, "version_conflict");
    if (before.kind !== "credit" || before.archived) throw new FinanceError("Choose an active credit account", 400, "invalid_account");
    const db = getDb(), timestamp = now();
    const previous = db.prepare("SELECT * FROM finance_credit_statements WHERE account_id=? AND statement_date=?").get(id, payload.statement_date) as { version: number } | undefined;
    const superseded = before.statement_day === null ? [] : (db.prepare("SELECT * FROM finance_credit_statements WHERE account_id=? AND statement_date<>?").all(id, payload.statement_date) as { statement_date: string }[])
      .filter(statement => nominalClose(before.statement_day!, statement.statement_date) === nominalClose(before.statement_day!, payload.statement_date));
    for (const statement of superseded) db.prepare("DELETE FROM finance_credit_statements WHERE account_id=? AND statement_date=?").run(id, statement.statement_date);
    if (previous?.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Statement version limit reached", 409, "version_conflict");
    db.prepare(`INSERT INTO finance_credit_statements (account_id,statement_date,due_date,balance_cents,minimum_due_cents,version,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(account_id,statement_date) DO UPDATE SET due_date=excluded.due_date,
      balance_cents=excluded.balance_cents, minimum_due_cents=excluded.minimum_due_cents,version=version+1,updated_at=excluded.updated_at`)
      .run(id, payload.statement_date, payload.due_date, balance, minimum, timestamp, timestamp);
    db.prepare("UPDATE finance_accounts SET version=version+1,updated_at=? WHERE id=?").run(timestamp, id);
    const account = readAccountBalance(id);
    return { result: { account }, affectedIds: [id], before: { account: before, statement: previous ?? null, superseded }, after: { account, statement: db.prepare("SELECT * FROM finance_credit_statements WHERE account_id=? AND statement_date=?").get(id, payload.statement_date) } };
  });
}
