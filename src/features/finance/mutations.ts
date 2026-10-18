import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { getDb, now } from "../../lib/db";
import { financeActorId } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";

export function parseFinance<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new FinanceError(parsed.error.issues[0]?.message ?? "Invalid input", 400, "invalid_input");
  return parsed.data;
}

export function financeMutation<T extends object>(actor: FinanceActor, requestId: string, operation: string, payload: object,
  change: () => { result: T; affectedIds: string[]; before: unknown; after: unknown }): T {
  const db = getDb();
  const actorId = financeActorId(actor);
  const encoded = JSON.stringify(payload);
  // Serialize retry checking, financial effects and audit in the same write transaction.
  return db.transaction(() => {
    const prior = db.prepare("SELECT operation, payload, result FROM finance_requests WHERE actor_id = ? AND request_id = ?")
      .get(actorId, requestId) as { operation: string; payload: string; result: string } | undefined;
    if (prior) {
      if (prior.operation !== operation || prior.payload !== encoded) throw new FinanceError("Request ID was already used with a different payload", 409, "request_conflict");
      return JSON.parse(prior.result) as T;
    }
    const { result, affectedIds, before, after } = change();
    const timestamp = now();
    db.prepare("INSERT INTO finance_audit (id, actor_id, request_id, operation, affected_ids, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), actorId, requestId, operation, JSON.stringify(affectedIds), JSON.stringify(before), JSON.stringify(after), timestamp);
    db.prepare("INSERT INTO finance_requests (actor_id, request_id, operation, payload, result, created_at) VALUES (?,?,?,?,?,?)")
      .run(actorId, requestId, operation, encoded, JSON.stringify(result), timestamp);
    return result;
  }).immediate();
}
