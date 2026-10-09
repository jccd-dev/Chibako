import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createNote, getNote } from "../src/lib/notes";
import { commitTarsiImport, createTarsiImportBackup, readTarsiImportBackup, verifyTarsiImportRecovery } from "../src/features/finance/import-commit";
import { previewTarsiBackup } from "../src/features/finance/import-preview";
import { getObligation } from "../src/features/finance/obligations";
import { getAccount, listAccounts } from "../src/features/finance/accounts";
import { createSession } from "../src/lib/auth";
import { POST as createBackupRoute } from "../src/app/api/finance/import/backup/route";
import { GET as downloadBackupRoute } from "../src/app/api/finance/import/backup/[id]/route";
import { POST as commitRoute } from "../src/app/api/finance/import/commit/route";
import { POST as recoveryRoute } from "../src/app/api/finance/import/recovery/verify/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-import-commit-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner = { kind: "owner" } as const;
const trustedLocal = { kind: "trusted-local" } as const;
const review = { exclusions: ["legacyRows", "legacyConfig"], acknowledged_exclusions: ["legacyRows", "legacyConfig"] };
function vaultSnapshot(db: Database.Database): string {
  const tables = db.prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type='table'
    AND (name LIKE 'finance_%' OR name IN ('notes','notes_fts','links','folders','bookmarks','note_embeddings')) ORDER BY name`).all();
  return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
}
beforeEach(() => getDb().transaction(() => {
  for (const table of [
    "finance_import_records", "finance_import_migrations", "finance_note_links", "finance_obligation_payments",
    "finance_obligation_writeoffs", "finance_refunds", "finance_goal_allocations", "finance_goals", "finance_budget_limits",
    "finance_budget_plans", "finance_plans", "finance_schedules", "finance_obligation_movements",
    "finance_obligations", "finance_movements", "finance_transactions", "finance_classifications",
    "finance_accounts", "finance_audit", "finance_requests",
  ]) getDb().prepare(`DELETE FROM ${table}`).run();
})());
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function source() {
  return { app: "Tarsi", data: {
    accounts: [
      { id: "cash", name: "TEST import cash", type: "debit", currency: "PHP", balance: 100, accountGroupId: "group", linkedGoalId: "goal" },
      { id: "asset", name: "TEST import asset", type: "asset", currency: "PHP", balance: 30 },
    ],
    expenses: [{ id: "shared-activity", accountId: "cash", amount: 10.25, date: "2020-02-29", recurringDueDate: "2020-02-29", category: "food", subcategoryId: "groceries", note: "TEST import expense", recurringExpenseId: "shared-schedule" }],
    incomes: [{ id: "shared-activity", accountId: "cash", amount: 20.1, date: "2020-02-29", category: "salary", tagId: "tag", recurringIncomeId: "shared-schedule" }],
    transfers: [{ id: "transfer", fromAccountId: "cash", toAccountId: "asset", amount: 5, date: "2020-03-01" }],
    balanceAdjustments: [{ id: "adjustment", accountId: "cash", currency: "PHP", previousBalance: 10, nextBalance: 12, date: "2020-03-01", kind: "reconciliation" }],
    recurringExpenses: [{ id: "shared-schedule", accountId: "cash", amount: 10.25, category: "food", subcategoryId: "groceries", interval: "monthly", nextDueDate: "2020-04-01" }],
    recurringIncomes: [{ id: "shared-schedule", accountId: "cash", amount: 20.1, category: "salary", interval: "monthly", nextDueDate: "2020-04-01" }],
    goals: [{ id: "goal", title: "TEST import goal", currency: "PHP", targetAmount: 50, currentAmount: 15, linkedAccountId: "cash", contributions: [{ id: "saved", amount: 15, accountId: "cash", date: "2020-03-01" }] }],
    debts: [{ id: "shared-obligation", name: "TEST import debt", currency: "PHP", totalAmount: 100, paidAmount: 20, contactId: "contact", creditorType: "person", borrowings: [{ id: "borrowed", amount: 100, accountId: "cash", date: "2020-02-01" }], payments: [{ id: "paid", amount: 20, accountId: "cash", date: "2020-03-01" }], mutualOffsets: [{ id: "debt-offset", amount: 1, accountId: "cash", date: "2020-03-02" }] }],
    receivables: [{ id: "shared-obligation", name: "TEST import receivable", currency: "PHP", totalAmount: 30, collectedAmount: 10, advances: [{ id: "advanced", amount: 30, accountId: "cash", date: "2020-02-01" }], collections: [{ id: "collected", amount: 10, accountId: "cash", date: "2020-03-01" }], mutualOffsets: [{ id: "receivable-offset", amount: 1, accountId: "cash", date: "2020-03-02" }] }],
    tags: [{ id: "tag", name: "TEST import tag" }],
    customCategories: [{ id: "food", label: "TEST food" }],
    customIncomeCategories: [{ id: "salary", label: "TEST salary" }],
    customSubcategories: [{ id: "groceries", parentCategoryId: "food", parentCategoryKind: "expense", label: "TEST groceries" }],
    accountGroups: [{ id: "group", name: "TEST group" }],
    sharedBalanceContacts: [{ id: "contact", name: "TEST contact" }],
    legacyRows: [{ id: "legacy", note: "TEST explicitly excluded" }, "TEST scalar exclusion", null],
    legacyConfig: { id: "legacy-config", enabled: false },
  } };
}

test("owner import uses a verified recoverable backup and restores Notes and finance in a separate Vault", async () => {
  const note = createNote({ title: "TEST preserved Note", content: "Existing Note content" });
  const noteBefore = getDb().prepare("SELECT id,title,folder,content FROM notes WHERE id=?").get(note.id);
  const vaultBefore = vaultSnapshot(getDb());
  const backup = await createTarsiImportBackup(owner);
  assert.equal(backup.verified, true);
  assert.throws(() => readTarsiImportBackup(trustedLocal, backup.id), { status: 403, code: "owner_required" });
  const report = previewTarsiBackup(owner, source(), review);
  const result = commitTarsiImport(owner, {
    request_id: "test-import-commit",
    backup_id: backup.id,
    proposal_hash: report.proposal_hash,
    backup: source(), ...review,
    final_confirmation: true,
  });
  assert.deepEqual(result.counts, { imported: 15, skipped: 9, excluded: 4 });
  assert.equal(result.records.length, 28);
  assert.ok(result.records.some(row => row.collection === "legacyRows" && row.status === "excluded"));
  assert.deepEqual(result.records.filter(row => row.path.startsWith("legacyRows[")).map(row => [row.source_id, row.status]), [
    ["legacy", "excluded"], ["row:1", "excluded"], ["row:2", "excluded"],
  ]);
  assert.deepEqual(result.records.find(row => row.path === "legacyRows[1]")?.reason, "Owner-approved exclusion.");
  assert.equal(result.records.find(row => row.path === "legacyRows[1]")?.source_id, "row:1");
  assert.deepEqual(result.records.filter(row => row.parent_source_id).map(row => [row.collection, row.source_id, row.parent_source_id, row.status]), [
    ["goals.contributions", "saved", "goal", "skipped"],
    ["debts.borrowings", "borrowed", "shared-obligation", "skipped"],
    ["debts.payments", "paid", "shared-obligation", "skipped"],
    ["debts.mutualOffsets", "debt-offset", "shared-obligation", "skipped"],
    ["receivables.advances", "advanced", "shared-obligation", "skipped"],
    ["receivables.collections", "collected", "shared-obligation", "skipped"],
    ["receivables.mutualOffsets", "receivable-offset", "shared-obligation", "skipped"],
  ]);
  assert.ok(result.records.filter(row => row.parent_source_id).every(row => /starting progress is preserved.*not replayed/i.test(row.reason ?? "")));
  assert.deepEqual(result.schedules, [
    { source_collection: "recurringExpenses", source_id: "shared-schedule", target_id: "recurringExpenses:shared-schedule", paused: true },
    { source_collection: "recurringIncomes", source_id: "shared-schedule", target_id: "recurringIncomes:shared-schedule", paused: true },
  ]);
  assert.deepEqual(result.relationships, [
    { source_collection: "accounts", source_id: "cash", source_path: "accounts[0].accountGroupId", source_target_id: "accounts:cash", field: "accountGroupId", reference_collection: "accountGroups", reference_source_id: "group", reference_target_id: null, preservation: "source_metadata", reason: "Finance has no account-group capability; the source reference is retained in source_json only." },
    { source_collection: "accounts", source_id: "cash", source_path: "accounts[0].linkedGoalId", source_target_id: "accounts:cash", field: "linkedGoalId", reference_collection: "goals", reference_source_id: "goal", reference_target_id: "goals:goal", preservation: "source_metadata", reason: "The referenced goal is imported, but finance accounts have no linked-goal field; the source reference is retained in source_json only." },
    { source_collection: "debts", source_id: "shared-obligation", source_path: "debts[0].contactId", source_target_id: "debts:shared-obligation", field: "contactId", reference_collection: "sharedBalanceContacts", reference_source_id: "contact", reference_target_id: null, preservation: "source_metadata", reason: "Finance has no shared-contact capability; the source reference is retained in source_json only." },
  ]);
  assert.deepEqual(result.progress, [
    { source_collection: "goals", source_id: "goal", target_collection: "goals", target_id: "goals:goal", kind: "saved", starting_progress_cents: 1500 },
    { source_collection: "debts", source_id: "shared-obligation", target_collection: "obligations", target_id: "debts:shared-obligation", kind: "paid", starting_progress_cents: 2000 },
    { source_collection: "receivables", source_id: "shared-obligation", target_collection: "obligations", target_id: "receivables:shared-obligation", kind: "collected", starting_progress_cents: 1000 },
  ]);
  assert.ok(result.records.some(row => row.collection === "legacyConfig" && row.status === "excluded"));
  assert.equal(getNote(note.id)?.content, "Existing Note content");
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_note_links").get()?.count, 0);
  assert.deepEqual(getDb().prepare<[], { id: string; opening_balance_cents: number }>("SELECT id,opening_balance_cents FROM finance_accounts WHERE id='accounts:cash'").get(), { id: "accounts:cash", opening_balance_cents: 9315 });
  assert.deepEqual(getDb().prepare<[], { id: string; paused: number }>("SELECT id,paused FROM finance_schedules ORDER BY id").all(), [
    { id: "recurringExpenses:shared-schedule", paused: 1 }, { id: "recurringIncomes:shared-schedule", paused: 1 },
  ]);
  assert.deepEqual(getDb().prepare<[], { id: string; schedule_id: string; occurrence_date: string; status: string; transaction_id: string }>("SELECT id,schedule_id,occurrence_date,status,transaction_id FROM finance_plans WHERE id='expenses:shared-activity:occurrence'").get(), {
    id: "expenses:shared-activity:occurrence", schedule_id: "recurringExpenses:shared-schedule", occurrence_date: "2020-02-29", status: "satisfied", transaction_id: "expenses:shared-activity",
  });
  assert.deepEqual(getDb().prepare<[], { id: string; starting_progress_cents: number }>("SELECT id,starting_progress_cents FROM finance_obligations ORDER BY id").all(), [
    { id: "debts:shared-obligation", starting_progress_cents: 2000 }, { id: "receivables:shared-obligation", starting_progress_cents: 1000 },
  ]);
  assert.deepEqual([getObligation(owner, "debts:shared-obligation").paid_cents, getObligation(owner, "debts:shared-obligation").outstanding_cents], [2000, 8000]);
  assert.deepEqual(getDb().prepare<[], { id: string; type: string; category_id: string; subcategory_id: string | null }>("SELECT id,type,category_id,subcategory_id FROM finance_transactions ORDER BY id").all(), [
    { id: "expenses:shared-activity", type: "expense", category_id: "customCategories:food", subcategory_id: "customSubcategories:groceries" },
    { id: "incomes:shared-activity", type: "income", category_id: "customIncomeCategories:salary", subcategory_id: null },
  ]);
  assert.deepEqual(getDb().prepare<[], { goal_id: string; account_id: string }>("SELECT goal_id,account_id FROM finance_goal_allocations").all(), [
    { goal_id: "goals:goal", account_id: "accounts:cash" },
  ]);
  assert.deepEqual(getDb().prepare<[], { id: string; account_id: string; destination_account_id: string | null }>("SELECT id,account_id,destination_account_id FROM finance_movements ORDER BY id").all(), [
    { id: "balanceAdjustments:adjustment", account_id: "accounts:cash", destination_account_id: null },
    { id: "transfers:transfer", account_id: "accounts:cash", destination_account_id: "accounts:asset" },
  ]);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_transactions").get()?.count, 2);
  assert.deepEqual(commitTarsiImport(owner, {
    request_id: "test-import-commit", backup_id: backup.id,
    proposal_hash: report.proposal_hash, backup: source(), ...review, final_confirmation: true,
  }), result);
  assert.throws(() => commitTarsiImport(owner, {
    request_id: "test-import-commit", backup_id: backup.id, proposal_hash: report.proposal_hash,
    backup: { ...source(), exportedAt: "changed payload" }, ...review, final_confirmation: true,
  }), { status: 409, code: "request_conflict" });
  assert.throws(() => commitTarsiImport(owner, {
    request_id: "test-import-commit", backup_id: backup.id, proposal_hash: report.proposal_hash,
    backup: source(), exclusions: ["legacyRows"], acknowledged_exclusions: ["legacyRows"], final_confirmation: true,
  }), { status: 409, code: "request_conflict" });
  assert.throws(() => commitTarsiImport(owner, {
    request_id: "test-import-commit", backup_id: backup.id, proposal_hash: report.proposal_hash,
    backup: source(), exclusions: review.exclusions, acknowledged_exclusions: ["legacyRows"], final_confirmation: true,
  }), { status: 409, code: "request_conflict" });
  assert.equal(readTarsiImportBackup(owner, backup.id).byteLength, backup.size_bytes);
  assert.deepEqual(getDb().prepare("SELECT id,title,folder,content FROM notes WHERE id=?").get(note.id), noteBefore);
  assert.notEqual(vaultSnapshot(getDb()), vaultBefore);
});

test("import revalidates approval, eligibility and owner-only access before writes", async () => {
  const backup = await createTarsiImportBackup(owner);
  const report = previewTarsiBackup(owner, source(), review);
  const input = { request_id: "stale-import", backup_id: backup.id, proposal_hash: report.proposal_hash, backup: source(), ...review, final_confirmation: true };
  assert.throws(() => commitTarsiImport(trustedLocal, input), { status: 403, code: "owner_required" });
  assert.throws(() => commitTarsiImport(owner, { ...input, proposal_hash: "0".repeat(64) }), { status: 409, code: "proposal_changed" });
  createNote({ title: "TEST changed after backup", content: "This makes the recovery snapshot stale." });
  assert.throws(() => commitTarsiImport(owner, input), { status: 409, code: "backup_stale" });
  getDb().prepare("INSERT INTO finance_import_migrations (id,source_hash,proposal_hash,created_at,result_json) VALUES ('unrelated','other','other',1,'{}')").run();
  assert.throws(() => commitTarsiImport(owner, input), { status: 409, code: "finance_not_empty" });
  getDb().prepare("DELETE FROM finance_import_migrations WHERE id='unrelated'").run();
  for (const table of ["finance_accounts", "finance_transactions", "finance_requests", "finance_audit", "finance_import_migrations", "finance_import_records"]) {
    assert.equal(getDb().prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0, table);
  }
});

test("expense and income built-in categories with the same source ID stay distinct", async () => {
  const backupSource = { app: "Tarsi", data: {
    accounts: [{ id: "cash", name: "TEST cash", type: "debit", currency: "PHP", balance: 10 }],
    expenses: [{ id: "expense", accountId: "cash", amount: 1, date: "2020-01-01", category: "other" }],
    incomes: [{ id: "income", accountId: "cash", amount: 2, date: "2020-01-01", category: "other" }],
  } };
  const backup = await createTarsiImportBackup(owner);
  const proposal = previewTarsiBackup(owner, backupSource, {});
  assert.equal(proposal.can_approve, true);
  commitTarsiImport(owner, {
    request_id: "same-built-in-category", backup_id: backup.id, proposal_hash: proposal.proposal_hash,
    backup: backupSource, final_confirmation: true,
  });
  assert.deepEqual(getDb().prepare<[], { id: string; type: string }>("SELECT id,type FROM finance_classifications WHERE id LIKE 'builtin-%' ORDER BY id").all(), [
    { id: "builtin-expense:other", type: "expense" }, { id: "builtin-income:other", type: "income" },
  ]);
  assert.deepEqual(getDb().prepare<[], { id: string; category_id: string }>("SELECT id,category_id FROM finance_transactions ORDER BY id").all(), [
    { id: "expenses:expense", category_id: "builtin-expense:other" },
    { id: "incomes:income", category_id: "builtin-income:other" },
  ]);
});

test("owner recovery verification restores into a disposable Vault and reports later changes", async () => {
  const note = createNote({ title: "TEST recovery baseline", content: "Before backup" });
  const backup = await createTarsiImportBackup(owner);
  assert.equal(verifyTarsiImportRecovery(owner, { request_id: "recovery-current", backup_id: backup.id }).changed_since_backup, false);
  getDb().prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("TEST_recovery_setting", "changed after backup");
  assert.equal(verifyTarsiImportRecovery(owner, { request_id: "recovery-settings-change", backup_id: backup.id }).changed_since_backup, true);
  assert.throws(() => verifyTarsiImportRecovery(trustedLocal, { request_id: "trusted-recovery", backup_id: backup.id }), { status: 403, code: "owner_required" });
  createNote({ title: "TEST recovery after backup", content: "Must not be silently discarded" });
  const noteCount = (getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM notes").get())!.count - 1;
  const verification = verifyTarsiImportRecovery(owner, { request_id: "verify-recovery-changed", backup_id: backup.id });
  assert.equal(verification.verified, true);
  assert.equal(verification.integrity_check, "ok");
  assert.equal(verification.snapshot_matches, true);
  assert.equal(verification.changed_since_backup, true);
  assert.equal(verification.restored_counts.notes, noteCount);
  assert.match(verification.warning, /reconcile the reported later Notes and finance changes/);
  assert.deepEqual(verifyTarsiImportRecovery(owner, { request_id: "verify-recovery-changed", backup_id: backup.id }), verification);
  assert.equal(getNote(note.id)?.content, "Before backup");
  assert.equal(previewTarsiBackup(owner, source(), review).inspection.eligible, true);

  const unauthenticated = await recoveryRoute(new NextRequest("http://localhost/api/finance/import/recovery/verify", { method: "POST" }));
  assert.equal(unauthenticated.status, 401);
  const bearer = await recoveryRoute(new NextRequest("http://localhost/api/finance/import/recovery/verify", {
    method: "POST", headers: { authorization: "Bearer invalid", "content-type": "application/json" },
    body: JSON.stringify({ request_id: "route-recovery-denied", backup_id: backup.id }),
  }));
  assert.equal(bearer.status, 403);
  const session = createSession();
  const ownerResponse = await recoveryRoute(new NextRequest("http://localhost/api/finance/import/recovery/verify", {
    method: "POST", headers: { cookie: `chibako_session=${session}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "route-recovery-owner", backup_id: backup.id }),
  }));
  assert.equal(ownerResponse.status, 200);
  assert.equal((await ownerResponse.json()).changed_since_backup, true);
});

test("audit failure rolls back imported finance rows, migration outcomes, and retry bookkeeping", async () => {
  const backup = await createTarsiImportBackup(owner);
  const report = previewTarsiBackup(owner, source(), review);
  getDb().exec("CREATE TEMP TRIGGER reject_import_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try {
    assert.throws(() => commitTarsiImport(owner, {
      request_id: "failed-import", backup_id: backup.id, proposal_hash: report.proposal_hash,
      backup: source(), ...review, final_confirmation: true,
    }), /audit unavailable/);
  } finally { getDb().exec("DROP TRIGGER reject_import_audit"); }
  for (const table of ["finance_accounts", "finance_transactions", "finance_requests", "finance_audit", "finance_import_migrations", "finance_import_records"]) {
    assert.equal(getDb().prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0, table);
  }
});

test("long source identities remain accessible through normal finance capabilities", async () => {
  const sourceId = "é".repeat(128);
  const input = { app: "Tarsi", data: {
    accounts: [
      { id: sourceId, name: "TEST long identity", type: "debit", currency: "PHP", balance: 10 },
      { id: "cash/%", name: "TEST URL delimiter identity", type: "debit", currency: "PHP", balance: 10 },
    ],
  } };
  const backup = await createTarsiImportBackup(owner);
  const proposal = previewTarsiBackup(owner, input);
  assert.equal(proposal.can_approve, true);
  const result = commitTarsiImport(owner, {
    request_id: "long-source-identity", backup_id: backup.id,
    proposal_hash: proposal.proposal_hash, backup: input, final_confirmation: true,
  });
  assert.equal(result.records[0].source_id, sourceId);
  for (const account of listAccounts(owner).accounts) {
    assert.equal(decodeURIComponent(account.id), account.id, "Route decoding must preserve the stored identity");
    assert.equal(getAccount(owner, account.id).balance_cents, 1000);
  }
});

test("empty optional dates commit as null and recurring occurrences fall back to the activity date", async () => {
  const input = { app: "Tarsi", data: {
    accounts: [{ id: "cash", name: "TEST optional dates", type: "debit", currency: "PHP", balance: 10 }],
    recurringExpenses: [{ id: "monthly", accountId: "cash", amount: 1, interval: "monthly", nextDueDate: "2020-01-01", endDate: "" }],
    expenses: [{ id: "planned", accountId: "cash", amount: 1, date: "2020-01-02", recurringDueDate: "", recurringExpenseId: "monthly", planned: true }],
    goals: [{ id: "goal", title: "TEST optional goal date", currency: "PHP", targetAmount: 10, currentAmount: 0, targetDate: "" }],
    debts: [{ id: "debt", name: "TEST optional obligation date", currency: "PHP", totalAmount: 10, paidAmount: 0, dueDate: "" }],
  } };
  const backup = await createTarsiImportBackup(owner);
  const proposal = previewTarsiBackup(owner, input);
  assert.equal(proposal.can_approve, true);
  commitTarsiImport(owner, {
    request_id: "empty-optional-dates", backup_id: backup.id,
    proposal_hash: proposal.proposal_hash, backup: input, final_confirmation: true,
  });
  assert.equal(getDb().prepare<[], { end_date: string | null }>("SELECT end_date FROM finance_schedules WHERE id='recurringExpenses:monthly'").get()?.end_date, null);
  assert.equal(getDb().prepare<[], { occurrence_date: string }>("SELECT occurrence_date FROM finance_plans WHERE id='expenses:planned'").get()?.occurrence_date, "2020-01-02");
  assert.equal(getDb().prepare<[], { due_date: string | null }>("SELECT due_date FROM finance_goals WHERE id='goals:goal'").get()?.due_date, null);
  assert.equal(getDb().prepare<[], { due_date: string | null }>("SELECT due_date FROM finance_obligations WHERE id='debts:debt'").get()?.due_date, null);

  const invalid = { ...input, data: { ...input.data, goals: [{ ...input.data.goals[0], targetDate: "2020-02-30" }] } };
  assert.equal(previewTarsiBackup(owner, invalid).can_approve, false);
});

test("backup and commit routes require an owner session and block unapproved exclusions", async () => {
  const unauthenticated = new NextRequest("http://localhost/api/finance/import/backup", { method: "POST" });
  assert.equal((await createBackupRoute(unauthenticated)).status, 401);
  const agent = new NextRequest("http://localhost/api/finance/import/backup", {
    method: "POST", headers: { authorization: "Bearer invalid" },
  });
  assert.equal((await createBackupRoute(agent)).status, 403);
  assert.equal((await commitRoute(new NextRequest("http://localhost/api/finance/import/commit", { method: "POST" }))).status, 401);
  assert.equal((await commitRoute(new NextRequest("http://localhost/api/finance/import/commit", {
    method: "POST", headers: { authorization: "Bearer invalid" },
  }))).status, 403);

  const session = createSession();
  const ownerRequest = (url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) => new NextRequest(url, {
    ...init, headers: { cookie: `chibako_session=${session}`, ...init.headers },
  });
  const backupResponse = await createBackupRoute(ownerRequest("http://localhost/api/finance/import/backup", { method: "POST" }));
  assert.equal(backupResponse.status, 201);
  const backup = await backupResponse.json() as { id: string };
  const download = await downloadBackupRoute(ownerRequest(`http://localhost/api/finance/import/backup/${backup.id}`), { params: Promise.resolve({ id: backup.id }) });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/vnd.sqlite3");

  const sourceWithExclusion = { app: "Tarsi", data: {
    accounts: [{ id: "cash", name: "TEST cash", type: "debit", currency: "PHP", balance: 10 }],
    expenses: [{ id: "expense", accountId: "cash", amount: 1, date: "2020-01-01", customField: "TEST private" }],
  } };
  const preview = previewTarsiBackup(owner, sourceWithExclusion, {
    exclusions: ["expenses.customField"], acknowledged_exclusions: ["expenses.customField"],
  });
  const rejected = await commitRoute(ownerRequest("http://localhost/api/finance/import/commit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_id: "route-exclusion", backup_id: backup.id, proposal_hash: preview.proposal_hash,
      backup: sourceWithExclusion, exclusions: ["expenses.customField"], final_confirmation: true }),
  }));
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, "proposal_not_approved");
});
