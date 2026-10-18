import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, getAccountSchema, type FinanceActor } from "./types";
import { parseFinance, financeMutation } from "./mutations";
import { createClassificationSchema, updateClassificationSchema, listClassificationsSchema, type FinanceClassification, type ClassificationPage } from "./activity-types";

type ClassificationRow = Omit<FinanceClassification, "archived"> & { archived: number };
export function readClassification(id: string): FinanceClassification {
  const row = getDb().prepare("SELECT * FROM finance_classifications WHERE id = ?").get(id) as ClassificationRow | undefined;
  if (!row) throw new FinanceError("Classification not found", 404, "not_found");
  return { ...row, archived: row.archived === 1 };
}
export function createClassification(actor: FinanceActor, input: unknown): { classification: FinanceClassification } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(createClassificationSchema, input);
  return financeMutation(actor, request_id, "classification.create", payload, () => {
    if (payload.parent_id) {
      const parent = readClassification(payload.parent_id);
      if (parent.kind !== "category" || parent.type !== payload.type || parent.parent_id || parent.archived) {
        throw new FinanceError("Subcategories require an active parent category of the same type", 400, "invalid_category");
      }
    }
    const id = randomUUID(), timestamp = now();
    getDb().prepare("INSERT INTO finance_classifications (id,kind,type,name,parent_id,archived,version,created_at,updated_at) VALUES (?,?,?,?,?,0,1,?,?)")
      .run(id, payload.kind, payload.type ?? null, payload.name, payload.parent_id, timestamp, timestamp);
    const classification = readClassification(id);
    return { result: { classification }, affectedIds: [id], before: null, after: classification };
  });
}
export function updateClassification(actor: FinanceActor, id: string, input: unknown): { classification: FinanceClassification } {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getAccountSchema, { id });
  const { request_id, ...patch } = parseFinance(updateClassificationSchema, input);
  return financeMutation(actor, request_id, "classification.update", { id, ...patch }, () => {
    const before = readClassification(id);
    if (before.version !== patch.version || before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Classification changed; refresh before editing", 409, "version_conflict");
    getDb().prepare("UPDATE finance_classifications SET name = ?, archived = ?, version = version + 1, updated_at = ? WHERE id = ?")
      .run(patch.name ?? before.name, Number(patch.archived ?? before.archived), now(), id);
    const classification = readClassification(id);
    return { result: { classification }, affectedIds: [id], before, after: classification };
  });
}
export function listClassifications(actor: FinanceActor, input: unknown = {}): ClassificationPage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listClassificationsSchema, input);
  const clauses: string[] = [], values: (string | number)[] = [];
  if (query.archived !== "all") { clauses.push("archived = ?"); values.push(Number(query.archived === "true")); }
  for (const key of ["kind", "type"] as const) if (query[key]) { clauses.push(`${key} = ?`); values.push(query[key]); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_classifications ${where}`).get(...values) as { total: number };
    const rows = db.prepare(`SELECT * FROM finance_classifications ${where} ORDER BY kind, type, name, id LIMIT ? OFFSET ?`).all(...values, query.limit, query.offset) as ClassificationRow[];
    return { classifications: rows.map(row => ({ ...row, archived: row.archived === 1 })), total, limit: query.limit, offset: query.offset };
  })();
}
