import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { dataDir, getDb, now } from "../../lib/db";
import { FinanceError, type FinanceActor } from "./types";
import { financeMutation, parseFinance } from "./mutations";
import { decimalCents } from "./money";
import { previewTarsiBackup } from "./import-preview";
import { tarsiTargetId as targetId } from "./import-preview-mapping";
import { isSourceObject } from "./import-source-format";
import type { TarsiPreview, TarsiProposalRecord } from "./import-preview-types";

const backupIdSchema = z.string().uuid();
const requestIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const commitSchema = z.object({
  request_id: requestIdSchema,
  backup_id: backupIdSchema,
  proposal_hash: z.string().regex(/^[a-f0-9]{64}$/),
  backup: z.unknown(),
  exclusions: z.array(z.string().min(1).max(512)).max(10_000).default([]),
  acknowledged_exclusions: z.array(z.string().min(1).max(512)).max(10_000).default([]),
  acknowledged_conflicts: z.array(z.string().min(1).max(512)).max(10_000).default([]),
  final_confirmation: z.literal(true),
}).strict();

const collectionOrder = [
  "accounts", "tags", "customCategories", "customIncomeCategories", "categoryOrderIds", "incomeCategoryOrderIds",
  "customSubcategories", "recurringExpenses", "recurringIncomes", "expenses", "incomes", "transfers",
  "balanceAdjustments", "goals", "debts", "receivables", "accountGroups", "sharedBalanceContacts",
];

export interface TarsiImportBackup {
  id: string;
  sha256: string;
  size_bytes: number;
  created_at: number;
  verified: true;
}

export interface TarsiImportResult {
  migration_id: string;
  source_hash: string;
  proposal_hash: string;
  counts: { imported: number; skipped: number; conflicts: number; excluded: number };
  records: { collection: string; source_id: string; path: string; parent_source_id: string | null; status: "imported" | "skipped" | "conflict" | "excluded"; reason: string | null; previous_source?: Record<string, unknown>; current_source?: Record<string, unknown> }[];
  balances: TarsiPreview["balances"];
  schedules: { source_collection: string; source_id: string; target_id: string; paused: true }[];
  progress: { source_collection: string; source_id: string; target_collection: "goals" | "obligations"; target_id: string; kind: "saved" | "paid" | "collected"; starting_progress_cents: number }[];
  relationships: { source_collection: string; source_id: string; source_path: string; source_target_id: string; field: "accountGroupId" | "linkedGoalId" | "contactId"; reference_collection: string; reference_source_id: string; reference_target_id: string | null; preservation: "source_metadata"; reason: string }[];
  exclusions: TarsiPreview["exclusions"];
}

function requireOwner(actor: FinanceActor): void {
  if (actor.kind !== "owner") throw new FinanceError("Tarsi import requires the owner session", 403, "owner_required");
}

function backupDirectory(): string {
  return path.join(dataDir(), "finance-import-backups");
}

function backupPath(id: string): string {
  if (!backupIdSchema.safeParse(id).success) throw new FinanceError("Backup was not found", 404, "not_found");
  return path.join(backupDirectory(), `${id}.db`);
}

function rowSnapshot(db: Database.Database, wholeVault = false): string {
  const filter = wholeVault ? "" : "AND (name LIKE 'finance_%' OR name IN ('notes','notes_fts','links','folders','bookmarks','note_embeddings'))";
  const tables = db.prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type='table' ${filter} ORDER BY name`).all();
  return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM \"${name.replaceAll('"', '""')}\"`).all().map(row => JSON.stringify(row)).sort()]));
}

function verifyBackup(file: string, requireCurrent = true): { db: Database.Database; buffer: Buffer } {
  let backup: Database.Database;
  try { backup = new Database(file, { readonly: true, fileMustExist: true }); }
  catch { throw new FinanceError("Verified backup is unavailable", 409, "backup_unavailable"); }
  try {
    const check = backup.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    if (check?.integrity_check !== "ok") throw new FinanceError("Verified backup is corrupt", 409, "backup_unavailable");
    if (requireCurrent && rowSnapshot(backup) !== rowSnapshot(getDb())) throw new FinanceError("Verified backup no longer matches this Vault", 409, "backup_stale");
    return { db: backup, buffer: fs.readFileSync(file) };
  } catch (error) {
    backup.close();
    throw error;
  }
}

export async function createTarsiImportBackup(actor: FinanceActor): Promise<TarsiImportBackup> {
  requireOwner(actor);
  const directory = backupDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const id = randomUUID();
  const file = backupPath(id);
  await getDb().backup(file);
  fs.chmodSync(file, 0o600);
  const { db, buffer } = verifyBackup(file);
  db.close();
  const restored = verifyDisposableRestore(file);
  if (!restored.matches) throw new FinanceError("Disposable recovery copy does not match the backup", 409, "backup_unavailable");
  return { id, sha256: createHash("sha256").update(buffer).digest("hex"), size_bytes: buffer.length, created_at: now(), verified: true };
}

export function readTarsiImportBackup(actor: FinanceActor, id: string): Buffer {
  requireOwner(actor);
  const { db, buffer } = verifyBackup(backupPath(id), false);
  db.close();
  return buffer;
}

function verifyDisposableRestore(file: string): { matches: boolean; counts: Record<string, number> } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chibako-finance-recovery-"));
  const restoredPath = path.join(directory, "brain.db");
  let backup: Database.Database | undefined;
  let restored: Database.Database | undefined;
  try {
    fs.copyFileSync(file, restoredPath, fs.constants.COPYFILE_EXCL);
    backup = new Database(file, { readonly: true, fileMustExist: true });
    restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
    const integrity = restored.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    if (!integrity.length || integrity.some(row => row.integrity_check !== "ok")) {
      throw new FinanceError("Disposable recovery copy failed SQLite integrity verification", 409, "backup_unavailable");
    }
    const tables = restored.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'finance_%' OR name IN ('notes','notes_fts','links','folders','bookmarks','note_embeddings')) ORDER BY name").all();
    const counts = Object.fromEntries(tables.map(({ name }) => [name,
      (restored!.prepare(`SELECT COUNT(*) AS count FROM \"${name.replaceAll('"', '""')}\"`).get() as { count: number }).count]));
    return { matches: rowSnapshot(restored, true) === rowSnapshot(backup, true), counts };
  } finally {
    restored?.close();
    backup?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export interface TarsiRecoveryVerification {
  backup_id: string;
  verified: true;
  integrity_check: "ok";
  snapshot_matches: true;
  changed_since_backup: boolean;
  restored_counts: Record<string, number>;
  warning: string;
}

const recoverySchema = z.object({ request_id: requestIdSchema, backup_id: backupIdSchema }).strict();
const recoveryResultSchema = z.object({
  backup_id: backupIdSchema,
  verified: z.literal(true),
  integrity_check: z.literal("ok"),
  snapshot_matches: z.literal(true),
  changed_since_backup: z.boolean(),
  restored_counts: z.record(z.string(), z.number().int().nonnegative()),
  warning: z.string(),
}).strict();

function recoveryRequestPath(requestId: string): string {
  const directory = path.join(backupDirectory(), "recovery-requests");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const key = createHash("sha256").update(requestId).digest("hex");
  return path.join(directory, `${key}.json`);
}

function readRecoveryRequest(file: string, backupId: string): TarsiRecoveryVerification | null {
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown; }
  catch { throw new FinanceError("Recovery request record is unavailable", 409, "recovery_unavailable"); }
  const request = z.object({ backup_id: backupIdSchema, result: recoveryResultSchema }).safeParse(parsed);
  if (!request.success) throw new FinanceError("Recovery request record is unavailable", 409, "recovery_unavailable");
  if (request.data.backup_id !== backupId) throw new FinanceError("Request ID was already used with a different payload", 409, "request_conflict");
  return request.data.result;
}

export function verifyTarsiImportRecovery(actor: FinanceActor, input: unknown): TarsiRecoveryVerification {
  requireOwner(actor);
  const parsed = parseFinance(recoverySchema, input);
  const requestFile = recoveryRequestPath(parsed.request_id);
  const prior = readRecoveryRequest(requestFile, parsed.backup_id);
  if (prior) return prior;
  const file = backupPath(parsed.backup_id);
  const { db: backup } = verifyBackup(file, false);
  try {
    const restored = verifyDisposableRestore(file);
    if (!restored.matches) throw new FinanceError("Disposable recovery copy does not match the backup", 409, "backup_unavailable");
    const result: TarsiRecoveryVerification = {
      backup_id: parsed.backup_id,
      verified: true,
      integrity_check: "ok",
      snapshot_matches: true,
      changed_since_backup: rowSnapshot(getDb(), true) !== rowSnapshot(backup, true),
      restored_counts: restored.counts,
      warning: "Verification never restores or overwrites the live Vault. If data changed since this backup, reconcile the reported later Notes and finance changes, plus settings, credentials and other Vault changes, before an offline restoration.",
    };
    const temporary = `${requestFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ backup_id: parsed.backup_id, result }), { mode: 0o600, flag: "wx" });
      try { fs.linkSync(temporary, requestFile); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return readRecoveryRequest(requestFile, parsed.backup_id)!;
      }
      return result;
    } finally { fs.rmSync(temporary, { force: true }); }
  } finally { backup.close(); }
}

function targetString(record: TarsiProposalRecord, key: string): string | null {
  const value = record.target[key];
  return typeof value === "string" ? value : null;
}

function targetNumber(record: TarsiProposalRecord, key: string): number {
  const value = record.target[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new FinanceError("Approved import mapping is invalid", 409, "proposal_changed");
  return value;
}

function tagIds(record: TarsiProposalRecord): string[] {
  const tag = targetString(record, "tag_id");
  return tag ? [targetId("tags", tag)] : [];
}

function originalSource(backup: unknown, record: TarsiProposalRecord, profileId: string | null): unknown {
  if (!isSourceObject(backup) || !isSourceObject(backup.data)) return record.source;
  const data = backup.data;
  const selected = profileId !== null && isSourceObject(data.profiles) ? data.profiles[profileId] : data;
  const path = record.path.match(/^([^.[\]]+)\[(\d+)\]$/);
  if (!isSourceObject(selected) || !path) return record.source;
  const rows = selected[path[1]];
  if (!Array.isArray(rows)) return record.source;
  const source = rows[Number(path[2])];
  if (typeof source === "string" && ["categoryOrderIds", "incomeCategoryOrderIds"].includes(path[1])) {
    return { id: source, order: Number(path[2]) };
  }
  return source ?? record.source;
}

function categoryId(records: TarsiProposalRecord[], sourceId: string, type: string, subcategory = false): string {
  const collections = subcategory ? ["customSubcategories"]
    : type === "income" ? ["customIncomeCategories"] : ["customCategories"];
  const match = records.find(record => collections.includes(record.collection) && record.source_id === sourceId && record.status !== "excluded");
  return match ? targetId(match.collection, sourceId) : targetId(`builtin-${type}`, sourceId);
}

function insertClassification(record: TarsiProposalRecord, records: TarsiProposalRecord[], timestamp: number): void {
  const type = record.collection === "customIncomeCategories" || record.collection === "incomeCategoryOrderIds"
    || record.target.type === "income" ? "income" : "expense";
  const id = record.collection.includes("CategoryOrder")
    ? categoryId(records, record.source_id, type) : targetId(record.collection, record.source_id);
  const parentSourceId = record.collection === "customSubcategories" ? targetString(record, "parent_id") : null;
  const parent = parentSourceId ? categoryId(records, parentSourceId, type) : null;
  const name = targetString(record, "name") ?? id;
  getDb().prepare(`INSERT INTO finance_classifications (id,kind,type,name,parent_id,created_at,updated_at)
    VALUES (?,'category',?,?,?,?,?)`).run(id, type, name, parent, timestamp, timestamp);
}

function ensureMappedCategories(records: TarsiProposalRecord[], timestamp: number): void {
  const db = getDb();
  const insert = db.prepare(`INSERT INTO finance_classifications (id,kind,type,name,created_at,updated_at)
    VALUES (?,'category',?,?,?,?)`);
  for (const record of records) {
    if (record.status === "excluded") continue;
    if (!["expenses", "incomes", "recurringExpenses", "recurringIncomes"].includes(record.collection)) continue;
    const type = record.collection === "incomes" || record.collection === "recurringIncomes" ? "income" : "expense";
    const sourceId = targetString(record, "category_id");
    if (!sourceId) continue;
    const id = categoryId(records, sourceId, type);
    if (!db.prepare("SELECT 1 FROM finance_classifications WHERE id=?").get(id)) insert.run(id, type, sourceId, timestamp, timestamp);
  }
}

function importRecord(record: TarsiProposalRecord, records: TarsiProposalRecord[], timestamp: number): { status: "imported" | "skipped"; reason: string | null } {
  const db = getDb(), id = targetId(record.collection, record.source_id);
  const target = record.target;
  const mapped = (collection: string, key: string) => {
    const value = targetString(record, key);
    return value ? targetId(collection, value) : null;
  };
  const category = (key: string, subcategory = false) => {
    const value = targetString(record, key);
    return value ? categoryId(records, value, targetString(record, "kind") ?? "expense", subcategory) : null;
  };
  switch (record.collection) {
    case "accounts":
      db.prepare(`INSERT INTO finance_accounts (id,name,kind,currency,opening_balance_cents,archived,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, targetString(record, "name"), targetString(record, "kind"), "PHP",
        targetNumber(record, "opening_balance_cents"), Number(record.source.archivedAt !== undefined && record.source.archivedAt !== null), timestamp, timestamp);
      return { status: "imported", reason: null };
    case "tags":
      db.prepare(`INSERT INTO finance_classifications (id,kind,type,name,archived,created_at,updated_at)
        VALUES (?,'tag',NULL,?,?,?,?)`).run(id, targetString(record, "name"), Number(record.source.status === "archived"), timestamp, timestamp);
      return { status: "imported", reason: null };
    case "customCategories": case "customIncomeCategories": case "customSubcategories":
    case "categoryOrderIds": case "incomeCategoryOrderIds":
      const classificationId = record.collection.includes("CategoryOrder")
        ? categoryId(records, record.source_id, record.collection === "incomeCategoryOrderIds" ? "income" : "expense") : id;
      if (record.collection.includes("CategoryOrder") && getDb().prepare("SELECT 1 FROM finance_classifications WHERE id=?").get(classificationId)) {
        return { status: "skipped", reason: "Category order is not stored separately from the imported category." };
      }
      insertClassification(record, records, timestamp);
      return { status: "imported", reason: null };
    case "recurringExpenses": case "recurringIncomes":
      db.prepare(`INSERT INTO finance_schedules (id,type,account_id,amount_cents,category_id,subcategory_id,text,tag_ids,
        interval_count,interval_unit,start_date,end_date,paused,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(id, targetString(record, "kind"), mapped("accounts", "account_id"),
        targetNumber(record, "amount_cents"), category("category_id"), category("subcategory_id", true),
        targetString(record, "text") ?? "", "[]", targetNumber(record, "interval_count"), targetString(record, "interval_unit"),
        targetString(record, "start_date"), targetString(record, "end_date"), timestamp, timestamp);
      return { status: "imported", reason: null };
    case "expenses": case "incomes": {
      const type = targetString(record, "kind");
      const scheduleSourceId = targetString(record, "schedule_id");
      const scheduleId = scheduleSourceId ? targetId(type === "income" ? "recurringIncomes" : "recurringExpenses", scheduleSourceId) : null;
      const account = mapped("accounts", "account_id");
      const amount = targetNumber(record, "amount_cents");
      const dueDate = targetString(record, "transaction_date");
      const occurrenceDate = targetString(record, "recurring_due_date") ?? dueDate;
      const categoryIdValue = category("category_id");
      const subcategoryIdValue = category("subcategory_id", true);
      const text = targetString(record, "text") ?? "";
      const tags = JSON.stringify(tagIds(record));
      if (target.status === "pending") {
        db.prepare(`INSERT INTO finance_plans (id,type,account_id,amount_cents,due_date,category_id,subcategory_id,text,tag_ids,schedule_id,occurrence_date,schedule_generation,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, type, account, amount, dueDate, categoryIdValue, subcategoryIdValue, text, tags, scheduleId, scheduleId ? occurrenceDate : null, scheduleId ? 1 : null, timestamp, timestamp);
      } else {
        db.prepare(`INSERT INTO finance_transactions (id,type,account_id,amount_cents,transaction_date,category_id,subcategory_id,text,tag_ids,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, type, account, amount, dueDate, categoryIdValue, subcategoryIdValue, text, tags, timestamp, timestamp);
        if (scheduleId) db.prepare(`INSERT INTO finance_plans (id,type,account_id,amount_cents,due_date,category_id,subcategory_id,text,tag_ids,schedule_id,occurrence_date,schedule_generation,status,transaction_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'satisfied',?,?,?)`).run(`${id}:occurrence`, type, account, amount, occurrenceDate, categoryIdValue, subcategoryIdValue, text, tags, scheduleId, occurrenceDate, 1, id, timestamp, timestamp);
      }
      return { status: "imported", reason: null };
    }
    case "transfers":
      db.prepare(`INSERT INTO finance_movements (id,type,account_id,destination_account_id,amount_cents,transaction_date,text,tag_ids,created_at,updated_at)
        VALUES (?,'transfer',?,?,?,?,?,'[]',?,?)`).run(id, mapped("accounts", "from_account_id"), mapped("accounts", "to_account_id"),
        targetNumber(record, "amount_cents"), targetString(record, "transaction_date"), targetString(record, "text") ?? "", timestamp, timestamp);
      return { status: "imported", reason: null };
    case "balanceAdjustments": {
      const accountId = targetString(record, "account_id");
      if (!accountId) throw new FinanceError("Approved account mapping is invalid", 409, "proposal_changed");
      const amount = (value: unknown) => {
        if (typeof value !== "number" && typeof value !== "string") throw new FinanceError("Approved adjustment mapping is invalid", 409, "proposal_changed");
        return decimalCents(String(value));
      };
      db.prepare(`INSERT INTO finance_movements (id,type,account_id,amount_cents,transaction_date,text,tag_ids,compared_balance_cents,actual_balance_cents,created_at,updated_at)
        VALUES (?,'reconciliation',?,?,?,'','[]',?,?,?,?)`).run(id, targetId("accounts", accountId), targetNumber(record, "amount_cents"),
        targetString(record, "transaction_date"), amount(record.source.previousBalance), amount(record.source.nextBalance), timestamp, timestamp);
      return { status: "imported", reason: null };
    }
    case "goals": {
      db.prepare(`INSERT INTO finance_goals (id,name,target_cents,saved_cents,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, targetString(record, "name"), targetNumber(record, "target_cents"), 0, targetString(record, "due_date"), timestamp, timestamp);
      const allocations = record.target.allocations;
      if (Array.isArray(allocations)) for (const allocation of allocations) {
        if (typeof allocation !== "object" || allocation === null) continue;
        const row = allocation as Record<string, unknown>;
        if (typeof row.account_id !== "string" || typeof row.amount_cents !== "number") throw new FinanceError("Approved goal mapping is invalid", 409, "proposal_changed");
        db.prepare("INSERT INTO finance_goal_allocations (goal_id,account_id,amount_cents) VALUES (?,?,?)").run(id, targetId("accounts", row.account_id), row.amount_cents);
        db.prepare(`INSERT INTO finance_goal_movements (id,goal_id,type,source_account_id,amount_cents,created_at)
          VALUES (?,?,'deposit',?,?,?)`).run(randomUUID(), id, targetId("accounts", row.account_id), row.amount_cents, timestamp);
      }
      return { status: "imported", reason: null };
    }
    case "debts": case "receivables":
      db.prepare(`INSERT INTO finance_obligations (id,kind,name,opening_principal_cents,starting_progress_cents,due_date,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, targetString(record, "kind"), targetString(record, "name"),
        targetNumber(record, "opening_principal_cents"), targetNumber(record, "starting_progress_cents"),
        targetString(record, "due_date"), timestamp, timestamp);
      return { status: "imported", reason: null };
    case "accountGroups": case "sharedBalanceContacts":
      return { status: "skipped", reason: "This source collection has no corresponding finance capability." };
    default:
      return { status: "skipped", reason: "This source item is not represented in the finance schema." };
  }
}

export function commitTarsiImport(actor: FinanceActor, input: unknown): TarsiImportResult {
  requireOwner(actor);
  const parsed = parseFinance(commitSchema, input);
  const reviewOptions = {
    exclusions: parsed.exclusions,
    acknowledged_exclusions: parsed.acknowledged_exclusions,
    acknowledged_conflicts: parsed.acknowledged_conflicts,
  };
  const sourceHash = createHash("sha256").update(JSON.stringify(parsed.backup)).digest("hex");
  const payload = {
    backup_id: parsed.backup_id,
    source_hash: sourceHash,
    proposal_hash: parsed.proposal_hash,
    exclusions: [...parsed.exclusions].sort(),
    acknowledged_exclusions: [...parsed.acknowledged_exclusions].sort(),
    acknowledged_conflicts: [...parsed.acknowledged_conflicts].sort(),
    final_confirmation: parsed.final_confirmation,
  };
  return financeMutation(actor, parsed.request_id, "finance.import.commit", payload, () => {
    const proposal = previewTarsiBackup(actor, parsed.backup, reviewOptions);
    if (!proposal.inspection.eligible) throw new FinanceError("Initial migration requires empty finance data", 409, "finance_not_empty");
    if (!proposal.can_approve) throw new FinanceError("Resolve all migration blockers and acknowledge exclusions before commit", 409, "proposal_not_approved");
    if (proposal.proposal_hash !== parsed.proposal_hash) throw new FinanceError("The reviewed proposal changed; review the current preview again", 409, "proposal_changed");
    const { db: verified } = verifyBackup(backupPath(parsed.backup_id));
    try {
      const db = getDb();
      const migrationId = proposal.inspection.retry_migration_id ?? randomUUID(), timestamp = now();
      const outcomes: TarsiImportResult["records"] = [];
      const counts = { imported: 0, skipped: 0, conflicts: 0, excluded: 0 };
      if (proposal.inspection.retry_migration_id) {
        db.prepare("UPDATE finance_import_migrations SET proposal_hash=? WHERE id=?").run(proposal.proposal_hash, migrationId);
      } else {
        db.prepare("INSERT INTO finance_import_migrations (id,source_hash,proposal_hash,created_at,result_json) VALUES (?,?,?,?,?)")
          .run(migrationId, sourceHash, proposal.proposal_hash, timestamp, "{}");
      }
      const insertOutcome = db.prepare(`INSERT INTO finance_import_records
        (migration_id,collection,source_id,source_path,status,reason,source_json) VALUES (?,?,?,?,?,?,?)`);
      const findImported = db.prepare<[string, string, string], { id: number }>(
        "SELECT id FROM finance_import_records WHERE migration_id=? AND collection=? AND source_id=? AND status='imported' LIMIT 1",
      );
      const updateOutcome = db.prepare("UPDATE finance_import_records SET source_path=?,status=?,reason=?,source_json=? WHERE id=?");
      const findByPath = db.prepare<[string, string], { id: number }>(
        "SELECT id FROM finance_import_records WHERE migration_id=? AND source_path=? LIMIT 1",
      );
      const findUnimported = db.prepare<[string, string, string], { id: number }>(
        "SELECT id FROM finance_import_records WHERE migration_id=? AND collection=? AND source_id=? AND status!='imported' LIMIT 1",
      );
      const persistOutcome = (record: TarsiProposalRecord, status: "imported" | "skipped" | "excluded", reason: string | null) => {
        if (findImported.get(migrationId, record.collection, record.source_id)) return;
        const existing = record.collection.includes(".")
          ? findByPath.get(migrationId, record.path)
          : findUnimported.get(migrationId, record.collection, record.source_id);
        const sourceJson = JSON.stringify(originalSource(parsed.backup, record, proposal.inspection.profile_id));
        if (existing) updateOutcome.run(record.path, status, reason, sourceJson, existing.id);
        else insertOutcome.run(migrationId, record.collection, record.source_id, record.path, status, reason, sourceJson);
      };
      const ordered = [...proposal.records].sort((a, b) => {
        const ai = collectionOrder.indexOf(a.collection), bi = collectionOrder.indexOf(b.collection);
        return (ai < 0 ? collectionOrder.length : ai) - (bi < 0 ? collectionOrder.length : bi);
      });
      const relationships: TarsiImportResult["relationships"] = [];
      let classificationsReady = false;
      for (const record of ordered) {
        if (!classificationsReady && ["recurringExpenses", "recurringIncomes", "expenses", "incomes"].includes(record.collection)) {
          ensureMappedCategories(ordered, timestamp);
          classificationsReady = true;
        }
        let status: "imported" | "skipped" | "conflict" | "excluded", reason: string | null;
        if (record.status === "excluded") { status = "excluded"; reason = "Owner-approved exclusion."; }
        else if (record.status === "skipped" || record.status === "conflict") { status = record.status; reason = record.reason ?? null; }
        else ({ status, reason } = importRecord(record, ordered, timestamp));
        counts[status === "conflict" ? "conflicts" : status]++;
        const result = {
          collection: record.collection, source_id: record.source_id, path: record.path, parent_source_id: null, status, reason,
          ...(status === "conflict" && record.previous_source ? { previous_source: record.previous_source, current_source: record.source } : {}),
        };
        outcomes.push(result);
        if (status !== "conflict") persistOutcome(record, status, reason);
        if (status === "imported") for (const [field, referenceCollection] of [
          ["accountGroupId", "accountGroups"], ["linkedGoalId", "goals"], ["contactId", "sharedBalanceContacts"],
        ] as const) {
          const referenceId = record.source[field];
          if (typeof referenceId !== "string" || !referenceId) continue;
          const hasNativeTarget = referenceCollection === "goals" && ordered.some(sourceRecord =>
            sourceRecord.collection === referenceCollection && sourceRecord.source_id === referenceId && sourceRecord.status !== "excluded");
          relationships.push({
            source_collection: record.collection,
            source_id: record.source_id,
            source_path: `${record.path}.${field}`,
            source_target_id: targetId(record.collection, record.source_id),
            field,
            reference_collection: referenceCollection,
            reference_source_id: referenceId,
            reference_target_id: hasNativeTarget ? targetId(referenceCollection, referenceId) : null,
            preservation: "source_metadata",
            reason: field === "linkedGoalId"
              ? `${hasNativeTarget ? "The referenced goal is imported, but " : "The referenced goal has no native destination record, and "}finance accounts have no linked-goal field; the source reference is retained in source_json only.`
              : `Finance has no ${field === "accountGroupId" ? "account-group" : "shared-contact"} capability; the source reference is retained in source_json only.`,
          });
        }
        const histories = ["contributions", "borrowings", "payments", "advances", "collections", "mutualOffsets"];
        for (const field of histories) {
          const rows = record.source[field];
          if (!Array.isArray(rows)) continue;
          for (const [index, source] of rows.entries()) {
            const sourceId = typeof source === "object" && source !== null && !Array.isArray(source) && "id" in source && typeof source.id === "string"
              ? source.id : `row:${index}`;
            const collection = `${record.collection}.${field}`;
            const path = `${record.path}.${field}[${index}]`;
            const nestedStatus = status === "excluded" ? "excluded" : "skipped";
            const nestedReason = nestedStatus === "excluded" ? "Parent source record was owner-excluded."
              : status === "conflict" ? "Parent source changed; existing starting progress is retained and history is not replayed."
              : status === "skipped" ? "Parent identity was already imported; historical cash is not replayed."
              : "Starting progress is preserved on the parent record; historical cash is not replayed.";
            counts[nestedStatus]++;
            outcomes.push({ collection, source_id: sourceId, path, parent_source_id: record.source_id, status: nestedStatus, reason: nestedReason });
            const old = findByPath.get(migrationId, path);
            if (old) updateOutcome.run(path, nestedStatus, nestedReason, JSON.stringify(source), old.id);
            else insertOutcome.run(migrationId, collection, sourceId, path, nestedStatus, nestedReason, JSON.stringify(source));
          }
        }
      }
      const schedules = ordered.filter(record => ["recurringExpenses", "recurringIncomes"].includes(record.collection)
        && outcomes.some(row => row.collection === record.collection && row.source_id === record.source_id && row.status === "imported"))
        .map(record => ({ source_collection: record.collection, source_id: record.source_id, target_id: targetId(record.collection, record.source_id), paused: true as const }));
      const progress: TarsiImportResult["progress"] = [];
      for (const record of ordered.filter(record => ["goals", "debts", "receivables"].includes(record.collection)
        && outcomes.some(row => row.collection === record.collection && row.source_id === record.source_id && row.status === "imported"))) {
        const amount = record.target.starting_progress_cents;
        if (typeof amount !== "number") continue;
        progress.push({
          source_collection: record.collection, source_id: record.source_id,
          target_collection: record.collection === "goals" ? "goals" : "obligations",
          target_id: targetId(record.collection, record.source_id),
          kind: record.collection === "goals" ? "saved" : record.collection === "debts" ? "paid" : "collected",
          starting_progress_cents: amount,
        });
      }
      const result: TarsiImportResult = {
        migration_id: migrationId, source_hash: sourceHash, proposal_hash: proposal.proposal_hash,
        counts, records: outcomes, balances: proposal.balances, schedules, progress, relationships, exclusions: proposal.exclusions,
      };
      db.prepare("UPDATE finance_import_migrations SET result_json=? WHERE id=?").run(JSON.stringify(result), migrationId);
      return { result, affectedIds: [migrationId, ...outcomes.map(row => `${row.collection}:${row.source_id}`)], before: null, after: result };
    } finally { verified.close(); }
  });
}
