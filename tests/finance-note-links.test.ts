import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createNote, getNote, updateNote, deleteNote, purgeNote } from "../src/lib/notes";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { getTransaction, listTransactions, postTransaction } from "../src/features/finance/activity";
import { postTransfer, reconcileAccount, valueAsset } from "../src/features/finance/movements";
import { correctActivity, recordRefund, revertActivity } from "../src/features/finance/corrections";
import { getActivityNoteLinks, setActivityNoteLinks } from "../src/features/finance/note-links";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-note-links-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const owner: FinanceActor = { kind: "owner" };
const action = (version: number, note_ids: string[]) => ({ request_id: randomUUID(), version, note_ids });
function fixture() {
  const account = createAccount(owner, { request_id: randomUUID(), name: randomUUID(), kind: "money", currency: "PHP", opening_balance: "100" }).account;
  const note = createNote({ title: randomUUID(), content: "Original Note content with [[context]]." });
  const transaction = postTransaction(owner, { request_id: randomUUID(), account_id: account.id, amount: "20", transaction_date: "2026-10-01", text: "Finance text stays here" }).transaction;
  return { account, note, transaction };
}

test("manual links are versioned, atomic, retry-safe and audited without changing Notes or financial effects", () => {
  const { account, note, transaction } = fixture();
  const beforeNote = getNote(note.id);
  const payload = action(1, [note.id]);
  const linked = setActivityNoteLinks(owner, transaction.id, payload);
  assert.equal(linked.transaction.version, 2);
  assert.equal(linked.balances[0].balance_cents, 8000);
  assert.deepEqual(setActivityNoteLinks(owner, transaction.id, payload), linked);
  assert.throws(() => setActivityNoteLinks(owner, transaction.id, { ...payload, note_ids: [] }), { code: "request_conflict" });
  assert.throws(() => setActivityNoteLinks(owner, transaction.id, action(1, [])), { code: "version_conflict" });
  assert.deepEqual(getActivityNoteLinks(owner, transaction.id).notes, [{ id: note.id, title: note.title }]);
  assert.equal(JSON.stringify(getTransaction(owner, transaction.id, { include_details: true })).includes(note.title), false);
  assert.equal(JSON.stringify(listTransactions(owner, { include_details: true })).includes(note.title), false);
  assert.equal(getTransaction(owner, transaction.id, { include_details: true }).text, "Finance text stays here");
  assert.deepEqual(getNote(note.id), beforeNote);
  assert.equal(getAccount(owner, account.id).balance_cents, 8000);
  const audit = getDb().prepare("SELECT * FROM finance_audit WHERE request_id = ?").get(payload.request_id) as { before_json: string; after_json: string; affected_ids: string; actor_id: string };
  assert.deepEqual(JSON.parse(audit.before_json).note_ids, []);
  assert.deepEqual(JSON.parse(audit.after_json).note_ids, [note.id]);
  assert.ok(JSON.parse(audit.affected_ids).includes(note.id));
  assert.equal(audit.actor_id, "owner");
  const removed = setActivityNoteLinks(owner, transaction.id, action(2, []));
  assert.equal(removed.transaction.version, 3);
  assert.deepEqual(getActivityNoteLinks(owner, transaction.id).notes, []);
  assert.deepEqual(getNote(note.id), beforeNote);
});

test("creation links validate within the posting transaction and need both scopes only when selected", () => {
  const { account, note } = fixture();
  const base = { request_id: randomUUID(), account_id: account.id, amount: "1", transaction_date: "2026-10-01", note_ids: [note.id] };
  const writer: FinanceActor = { kind: "api-key", id: "writer", scopes: ["finance:write"] };
  assert.throws(() => postTransaction(writer, base), { code: "forbidden" });
  const beforeBalance = getAccount(owner, account.id).balance_cents;
  assert.throws(() => postTransaction(owner, { ...base, note_ids: [randomUUID()] }), { code: "invalid_note" });
  assert.equal(getAccount(owner, account.id).balance_cents, beforeBalance);
  assert.equal(getDb().prepare("SELECT 1 FROM finance_requests WHERE request_id = ?").get(base.request_id), undefined);
  const posted = postTransaction(owner, base);
  assert.deepEqual(postTransaction(owner, base), posted);
  assert.deepEqual(getActivityNoteLinks(owner, posted.transaction.id).notes, [{ id: note.id, title: note.title }]);
  const unlinkedPayload = { ...base, request_id: randomUUID(), note_ids: [] };
  const unlinked = postTransaction(writer, unlinkedPayload);
  const stored = getDb().prepare("SELECT payload FROM finance_requests WHERE request_id = ?").get(unlinkedPayload.request_id) as { payload: string };
  assert.equal("note_ids" in JSON.parse(stored.payload), false, "keep pre-ticket retry fingerprints compatible when no links were selected");
  const { note_ids: omitted, ...legacyInput } = unlinkedPayload;
  void omitted;
  assert.deepEqual(postTransaction(writer, legacyInput), unlinked);
  assert.throws(() => setActivityNoteLinks(owner, posted.transaction.id, action(1, [note.id, note.id])), { code: "invalid_input" });
  assert.throws(() => setActivityNoteLinks(owner, posted.transaction.id, action(1, Array.from({ length: 21 }, () => randomUUID()))), { code: "invalid_input" });
});

test("all existing Activity types support explicit links; corrections retain them and Note lifecycle never exposes Trash", () => {
  const { account, note, transaction } = fixture();
  const destination = createAccount(owner, { request_id: randomUUID(), name: randomUUID(), kind: "money", currency: "PHP", opening_balance: "0" }).account;
  const transfer = postTransfer(owner, { request_id: randomUUID(), source_account_id: account.id, destination_account_id: destination.id, amount: "5", transaction_date: "2026-10-01", note_ids: [note.id] }).transaction;
  assert.equal(getActivityNoteLinks(owner, transfer.id).notes.length, 1);
  const reconciled = reconcileAccount(owner, { request_id: randomUUID(), account_id: destination.id, expected_balance_cents: 500, actual_balance: "5", transaction_date: "2026-10-01" }).transaction;
  const asset = createAccount(owner, { request_id: randomUUID(), name: randomUUID(), kind: "asset", currency: "PHP", opening_balance: "0" }).account;
  const valued = valueAsset(owner, { request_id: randomUUID(), account_id: asset.id, expected_balance_cents: 0, actual_balance: "1", transaction_date: "2026-10-01" }).transaction;
  const income = postTransaction(owner, { request_id: randomUUID(), type: "income", account_id: account.id, amount: "1", transaction_date: "2026-10-01" }).transaction;
  for (const record of [reconciled, valued, income]) {
    const linked = setActivityNoteLinks(owner, record.id, action(1, [note.id]));
    assert.equal(linked.transaction.version, 2);
    assert.equal(getActivityNoteLinks(owner, record.id).notes.length, 1);
  }
  const refund = recordRefund(owner, transaction.id, { request_id: randomUUID(), version: 1, amount: "1", account_id: account.id, transaction_date: "2026-10-02" }).transaction;
  setActivityNoteLinks(owner, refund.id, action(1, [note.id]));
  const corrected = correctActivity(owner, refund.id, { request_id: randomUUID(), version: 2, text: "Correction" }).transaction;
  assert.equal(getActivityNoteLinks(owner, corrected.id).notes.length, 1);
  revertActivity(owner, corrected.id, { request_id: randomUUID(), version: corrected.version });
  assert.equal(getActivityNoteLinks(owner, corrected.id).notes.length, 1);
  updateNote(note.id, { title: "Renamed " + randomUUID() });
  assert.equal(getActivityNoteLinks(owner, corrected.id).notes[0].title, getNote(note.id)?.title);
  deleteNote(note.id);
  assert.deepEqual(getActivityNoteLinks(owner, corrected.id).notes, []);
  assert.throws(() => setActivityNoteLinks(owner, transfer.id, action(1, [note.id])), { code: "invalid_note" });
  purgeNote(note.id);
  assert.deepEqual(getActivityNoteLinks(owner, transfer.id).notes, []);
});
