import { getDb, now } from "../../lib/db";
import { getNote } from "../../lib/notes";
import { listNoteChoices } from "../notes/note-choices";
import { authorizeFinance, authorizeFinanceNotes } from "../../server/auth/finance-authorization";
import { readTransaction } from "./activity";
import { readAccountBalance } from "./accounts";
import { financeMutation, parseFinance } from "./mutations";
import { readActivityNoteIds, replaceActivityNoteLinks } from "./note-link-storage";
import { financeNoteChoicesSchema, getActivityNoteLinksSchema, setActivityNoteLinksSchema, type ActivityNoteLinks } from "./note-link-types";
import { FinanceError, type FinanceActor } from "./types";

export function getFinanceNoteChoices(actor: FinanceActor, input: unknown = {}) {
  authorizeFinance(actor, "finance:read");
  authorizeFinanceNotes(actor);
  return listNoteChoices(parseFinance(financeNoteChoicesSchema, input));
}

export function getActivityNoteLinks(actor: FinanceActor, id: string): ActivityNoteLinks {
  authorizeFinance(actor, "finance:read");
  authorizeFinanceNotes(actor);
  parseFinance(getActivityNoteLinksSchema, { id });
  return getDb().transaction(() => {
    const record = readTransaction(id, false);
    const notes = readActivityNoteIds(id).flatMap(noteId => {
      const note = getNote(noteId);
      return note ? [{ id: note.id, title: note.title }] : [];
    });
    return { id, version: record.version, notes };
  })();
}

export function setActivityNoteLinks(actor: FinanceActor, id: string, input: unknown) {
  authorizeFinance(actor, "finance:write");
  authorizeFinanceNotes(actor);
  parseFinance(getActivityNoteLinksSchema, { id });
  const { request_id, ...payload } = parseFinance(setActivityNoteLinksSchema, input);
  return financeMutation(actor, request_id, "activity.note-links", { id, ...payload }, () => {
    const record = readTransaction(id, false);
    if (record.version !== payload.version || record.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Activity changed; refresh before editing Note links", 409, "version_conflict");
    const before = { version: record.version, note_ids: readActivityNoteIds(id) };
    replaceActivityNoteLinks(id, payload.note_ids);
    const table = record.type === "refund" ? "finance_refunds" : record.type === "income" || record.type === "expense" ? "finance_transactions" : "finance_movements";
    getDb().prepare(`UPDATE ${table} SET version = version + 1, updated_at = ? WHERE id = ?`).run(now(), id);
    const accountIds = [record.account_id, ...(record.destination_account_id ? [record.destination_account_id] : [])];
    const result = { transaction: readTransaction(id, false), note_ids: payload.note_ids, balances: accountIds.map(account_id => ({ account_id, balance_cents: readAccountBalance(account_id).balance_cents })) };
    return { result, affectedIds: [...new Set([id, ...before.note_ids, ...payload.note_ids])], before, after: { version: result.transaction.version, note_ids: payload.note_ids } };
  });
}
