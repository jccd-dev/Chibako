import { z } from "zod";
import { getDb } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { parseFinance } from "./mutations";

export const listTarsiImportSummariesSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  include_details: z.boolean().default(false),
}).strict();

const storedResultSchema = z.object({
  counts: z.object({
    imported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative().default(0),
    excluded: z.number().int().nonnegative(),
  }).strict(),
}).passthrough();

type TarsiStoredImportResult = z.infer<typeof storedResultSchema>;

export interface TarsiImportSummary {
  migration_id: string;
  created_at: number;
  counts: TarsiStoredImportResult["counts"];
  details?: {
    result: TarsiStoredImportResult;
    records: { collection: string; source_id: string; source_path: string; status: "imported" | "skipped" | "excluded"; reason: string | null; source: unknown }[];
  };
}

export interface TarsiImportSummaryPage {
  migrations: TarsiImportSummary[];
  total: number;
  limit: number;
  offset: number;
}

export function listTarsiImportSummaries(actor: FinanceActor, input: unknown = {}): TarsiImportSummaryPage {
  authorizeFinance(actor, "finance:read");
  const { limit, offset, include_details } = parseFinance(listTarsiImportSummariesSchema, input);
  const db = getDb();
  const total = (db.prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM finance_import_migrations").get())!.total;
  const rows = db.prepare<[number, number], { id: string; created_at: number; result_json: string }>(
    "SELECT id,created_at,result_json FROM finance_import_migrations ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
  ).all(limit, offset);
  const migrations: TarsiImportSummary[] = rows.map(row => {
    let decoded: unknown;
    try { decoded = JSON.parse(row.result_json); }
    catch { throw new FinanceError("Stored import summary is unavailable", 409, "summary_unavailable"); }
    const result = storedResultSchema.safeParse(decoded);
    if (!result.success) throw new FinanceError("Stored import summary is unavailable", 409, "summary_unavailable");
    const summary = { migration_id: row.id, created_at: row.created_at, counts: result.data.counts };
    if (!include_details) return summary;
    const records = db.prepare<[string], { collection: string; source_id: string; source_path: string; status: "imported" | "skipped" | "excluded"; reason: string | null; source_json: string }>(
      "SELECT collection,source_id,source_path,status,reason,source_json FROM finance_import_records WHERE migration_id=? ORDER BY id",
    ).all(row.id).map(record => {
      let source: unknown;
      try { source = JSON.parse(record.source_json); }
      catch { throw new FinanceError("Stored import details are unavailable", 409, "summary_unavailable"); }
      return { collection: record.collection, source_id: record.source_id, source_path: record.source_path, status: record.status, reason: record.reason, source };
    });
    return { ...summary, details: { result: result.data, records } };
  });
  return { migrations, total, limit, offset };
}
