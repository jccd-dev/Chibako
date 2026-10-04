import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance, authorizeFinanceNotes } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { readAccountBalance } from "./accounts";
import { readTransaction, insertTransaction, validateTransactionClassifications } from "./activity";
import { financeMutation, parseFinance } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { postTransferSchema, postAdjustmentSchema, type PostedMovement } from "./movement-types";
import { replaceActivityNoteLinks } from "./note-link-storage";

export function reconcileAccount(actor: FinanceActor, input: unknown): PostedMovement {
  return postAdjustment(actor, input, "reconciliation");
}
export function valueAsset(actor: FinanceActor, input: unknown): PostedMovement {
  return postAdjustment(actor, input, "valuation");
}
function postAdjustment(actor: FinanceActor, input: unknown, type: "reconciliation" | "valuation"): PostedMovement {
  authorizeFinance(actor, "finance:write");
  const { request_id, note_ids, ...payload } = parseFinance(postAdjustmentSchema, input);
  if (note_ids.length) authorizeFinanceNotes(actor);
  const actual = decimalCents(payload.actual_balance);
  return financeMutation(actor, request_id, `${type}.post`, note_ids.length ? { ...payload, note_ids } : payload, () => {
    const before = readAccountBalance(payload.account_id);
    if (before.archived || before.kind !== (type === "valuation" ? "asset" : "money")) throw new FinanceError(type === "valuation" ? "Choose an active asset account" : "Choose an active money account", 400, "invalid_account");
    if (before.balance_cents !== payload.expected_balance_cents) throw new FinanceError("Balance changed; refresh and compare again", 409, "balance_conflict");
    validateTransactionClassifications({ type: "expense", category_id: null, subcategory_id: null, tag_ids: payload.tag_ids });
    const difference = exactCents(BigInt(actual) - BigInt(before.balance_cents));
    const id = randomUUID(), timestamp = now();
    getDb().prepare("INSERT INTO finance_movements (id,type,account_id,amount_cents,transaction_date,text,tag_ids,compared_balance_cents,actual_balance_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, type, before.id, difference, payload.transaction_date, payload.text, JSON.stringify(payload.tag_ids), before.balance_cents, actual, timestamp, timestamp);
    replaceActivityNoteLinks(id, note_ids);
    const result: PostedMovement = { transaction: readTransaction(id, false), fee: null, balances: [{ account_id: before.id, balance_cents: actual }], warnings: actual < 0 ? ["negative_balance"] : [] };
    return { result, affectedIds: [id, before.id, ...note_ids], before, after: { transaction: readTransaction(id, true), note_ids, balances: result.balances } };
  });
}

export function postTransfer(actor: FinanceActor, input: unknown): PostedMovement {
  authorizeFinance(actor, "finance:write");
  const { request_id, note_ids, ...payload } = parseFinance(postTransferSchema, input);
  if (note_ids.length) authorizeFinanceNotes(actor);
  const amount = decimalCents(payload.amount), feeAmount = payload.fee ? decimalCents(payload.fee.amount) : 0;
  if (amount <= 0 || (payload.fee && feeAmount <= 0)) throw new FinanceError("Transfer and fee amounts must be positive", 400, "invalid_input");
  return financeMutation(actor, request_id, "transfer.post", note_ids.length ? { ...payload, note_ids } : payload, () => {
    const source = readAccountBalance(payload.source_account_id), destination = readAccountBalance(payload.destination_account_id);
    if ([source, destination].some(account => account.kind !== "money" || account.archived)) throw new FinanceError("Choose two active money accounts", 400, "invalid_account");
    validateTransactionClassifications({ type: "expense", category_id: payload.fee?.category_id ?? null, subcategory_id: payload.fee?.subcategory_id ?? null, tag_ids: payload.tag_ids });
    const balances = [
      { account_id: source.id, balance_cents: exactCents(BigInt(source.balance_cents) - BigInt(amount) - BigInt(feeAmount)) },
      { account_id: destination.id, balance_cents: exactCents(BigInt(destination.balance_cents) + BigInt(amount)) },
    ];
    const id = randomUUID(), timestamp = now();
    const feeId = payload.fee ? insertTransaction({ type: "expense", account_id: source.id, amount_cents: feeAmount, transaction_date: payload.transaction_date, category_id: payload.fee.category_id, subcategory_id: payload.fee.subcategory_id, text: "Transfer fee", tag_ids: [] }) : null;
    getDb().prepare("INSERT INTO finance_movements (id,type,account_id,destination_account_id,amount_cents,transaction_date,text,tag_ids,fee_transaction_id,created_at,updated_at) VALUES (?,'transfer',?,?,?,?,?,?,?,?,?)")
      .run(id, source.id, destination.id, amount, payload.transaction_date, payload.text, JSON.stringify(payload.tag_ids), feeId, timestamp, timestamp);
    replaceActivityNoteLinks(id, note_ids);
    const result: PostedMovement = { transaction: readTransaction(id, false), fee: feeId ? readTransaction(feeId, false) : null, balances, warnings: balances.some(account => account.balance_cents < 0) ? ["negative_balance"] : [] };
    return { result, affectedIds: [id, source.id, destination.id, ...(feeId ? [feeId] : []), ...note_ids], before: { source, destination }, after: { transaction: readTransaction(id, true), note_ids, fee: result.fee, balances } };
  });
}
