import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { financeMutation, parseFinance } from "./mutations";
import { validateTransactionClassifications } from "./activity";
import { pendingPlan, positiveAmount, readPlan, validatePlanAccount } from "./planning";
import { createScheduleSchema, updateScheduleSchema, getScheduleSchema, listSchedulesSchema, scheduleActionSchema, catchUpPlansSchema, skipPlansSchema,
  type FinanceSchedule, type SchedulePage, type CatchUpResult, type SkippedPlans } from "./recurrence-types";

type ScheduleRow = Omit<FinanceSchedule, "currency" | "paused" | "next_due_date" | "tag_ids"> & {
  paused: number; text: string; tag_ids: string; next_index: number; generation: number; created_at: number; updated_at: number;
};
type ExistingOccurrence = {
  id: string;
  status: "pending" | "satisfied" | "cancelled";
  cancel_reason: "skipped" | "boundary" | "cadence" | null;
  schedule_generation: number | null;
  version: number;
};
const selection = `SELECT s.*, a.name AS account_name, c.name AS category_name FROM finance_schedules s
  JOIN finance_accounts a ON a.id=s.account_id LEFT JOIN finance_classifications c ON c.id=s.category_id`;
function readRow(id: string): ScheduleRow {
  const row = getDb().prepare(`${selection} WHERE s.id=?`).get(id) as ScheduleRow | undefined;
  if (!row) throw new FinanceError("Schedule not found", 404, "not_found");
  return row;
}
const today = () => new Date().toISOString().slice(0, 10);
// Always calculate from the anchor: clamping February must not turn March 31 into March 28.
function occurrenceDate(schedule: Pick<ScheduleRow, "start_date" | "end_date" | "interval_count" | "interval_unit">, index: number): string | null {
  const [year, month, day] = schedule.start_date.split("-").map(Number), steps = index * schedule.interval_count;
  let date: Date;
  if (schedule.interval_unit === "day" || schedule.interval_unit === "week") {
    date = new Date(`${schedule.start_date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + steps * (schedule.interval_unit === "week" ? 7 : 1));
  } else {
    const months = month - 1 + (schedule.interval_unit === "year" ? steps * 12 : steps);
    const targetYear = year + Math.floor(months / 12), targetMonth = months % 12;
    if (targetYear > 9999) return null;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  }
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  const result = date.toISOString().slice(0, 10);
  return schedule.end_date && result > schedule.end_date ? null : result;
}
function futureIndex(schedule: ScheduleRow, after: string): number {
  let low = 0, high = 4000000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2), date = occurrenceDate(schedule, mid);
    if (date === null || date > after) high = mid; else low = mid + 1;
  }
  return low;
}
function fromRow(row: ScheduleRow, details: boolean): FinanceSchedule {
  const { text, tag_ids, created_at, updated_at, next_index, generation: _generation, paused, ...compact } = row;
  const pending = getDb().prepare("SELECT MIN(occurrence_date) AS date FROM finance_plans WHERE schedule_id=? AND status='pending' AND occurrence_date>?")
    .get(row.id, today()) as { date: string | null };
  return { ...compact, currency: "PHP", paused: !!paused, next_due_date: pending.date ?? occurrenceDate(row, next_index),
    ...(details ? { text, tag_ids: JSON.parse(tag_ids) as string[], created_at, updated_at } : {}) };
}
function readSchedule(id: string, details = false) { return fromRow(readRow(id), details); }
function editableSchedule(id: string, version: number) {
  const row = readRow(id);
  if (row.version !== version || row.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Schedule changed; refresh before editing", 409, "version_conflict");
  return row;
}
export function getSchedule(actor: FinanceActor, id: string, input: unknown = {}): FinanceSchedule {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(getScheduleSchema, { ...input as object, id });
  return readSchedule(query.id, query.include_details);
}
export function listSchedules(actor: FinanceActor, input: unknown = {}): SchedulePage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listSchedulesSchema, input), db = getDb();
  const where = query.paused === "all" ? "" : "WHERE s.paused=?", args = query.paused === "all" ? [] : [Number(query.paused === "true")];
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_schedules s ${where}`).get(...args) as { total: number };
    const rows = db.prepare(`${selection} ${where} ORDER BY s.start_date,s.id LIMIT ? OFFSET ?`).all(...args, query.limit, query.offset) as ScheduleRow[];
    return { schedules: rows.map(row => fromRow(row, query.include_details)), total, limit: query.limit, offset: query.offset };
  })();
}
export function createSchedule(actor: FinanceActor, input: unknown): { schedule: FinanceSchedule } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(createScheduleSchema, input), amount = positiveAmount(payload.amount);
  return financeMutation(actor, request_id, "schedule.create", payload, () => {
    validatePlanAccount(payload.account_id); validateTransactionClassifications(payload);
    const id = randomUUID(), timestamp = now();
    getDb().prepare(`INSERT INTO finance_schedules (id,type,account_id,amount_cents,category_id,subcategory_id,text,tag_ids,interval_count,interval_unit,start_date,end_date,paused,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, payload.type, payload.account_id, amount, payload.category_id, payload.subcategory_id, payload.text,
      JSON.stringify(payload.tag_ids), payload.interval_count, payload.interval_unit, payload.start_date, payload.end_date, Number(payload.paused), timestamp, timestamp);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id], before: null, after: readSchedule(id, true) };
  });
}
function needsOccurrence(row: ScheduleRow, through: string): boolean {
  const date = occurrenceDate(row, row.next_index);
  if (!date) return false;
  // Keep one upcoming occurrence; advancing the cursor must not add another on every refresh.
  const prior = row.next_index > 0 ? occurrenceDate(row, row.next_index - 1) : null;
  return date <= through || !prior || prior <= through;
}
export function catchUpPlans(actor: FinanceActor, input: unknown): CatchUpResult {
  authorizeFinance(actor, "finance:write");
  const { request_id, ...payload } = parseFinance(catchUpPlansSchema, input);
  return financeMutation(actor, request_id, "plan.catch_up", payload, () => {
    const through = payload.through_date ?? today(), db = getDb();
    const rows = db.prepare(`${selection} WHERE s.paused=0 ORDER BY s.id`).all() as ScheduleRow[];
    const created: string[] = [], advanced: string[] = []; let remaining = 1000;
    const insert = db.prepare(`INSERT INTO finance_plans (id,type,account_id,amount_cents,due_date,category_id,subcategory_id,text,tag_ids,schedule_id,occurrence_date,schedule_generation,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) {
      const initialIndex = row.next_index;
      while (remaining > 0 && needsOccurrence(row, through)) {
        const date = occurrenceDate(row, row.next_index)!, id = randomUUID(), timestamp = now();
        const existing = db.prepare(`SELECT id,status,cancel_reason,schedule_generation,version FROM finance_plans
          WHERE schedule_id=? AND occurrence_date=?
          ORDER BY CASE WHEN schedule_generation=? THEN 0 ELSE 1 END,schedule_generation DESC`)
          .all(row.id, date, row.generation) as ExistingOccurrence[];
        const current = existing.find(plan => plan.schedule_generation === row.generation);
        const alreadyActive = existing.some(plan => plan.status === "pending" || plan.status === "satisfied");
        // Older cancellations have no reason; preserve them as skips unless the migration
        // could identify them as an end-boundary cancellation.
        const explicitlySkipped = existing.some(plan => plan.status === "cancelled"
          && (plan.cancel_reason === "skipped" || plan.cancel_reason === null));
        if (!alreadyActive && !explicitlySkipped) {
          const reopen = current?.status === "cancelled" && current.cancel_reason !== null
            ? current
            : current ? undefined : existing.find(plan => plan.status === "cancelled" && plan.cancel_reason === "boundary");
          if (reopen) {
            if (reopen.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Plan version limit reached", 409, "version_conflict");
            db.prepare(`UPDATE finance_plans SET type=?,account_id=?,amount_cents=?,due_date=?,category_id=?,subcategory_id=?,
              text=?,tag_ids=?,status='pending',transaction_id=NULL,schedule_generation=?,cancel_reason=NULL,version=version+1,updated_at=?
              WHERE id=? AND status='cancelled' AND version=?`)
              .run(row.type, row.account_id, row.amount_cents, date, row.category_id, row.subcategory_id, row.text, row.tag_ids,
                row.generation, timestamp, reopen.id, reopen.version);
            created.push(reopen.id);
          } else if (!current) {
            insert.run(id, row.type, row.account_id, row.amount_cents, date, row.category_id, row.subcategory_id, row.text, row.tag_ids,
              row.id, date, row.generation, timestamp, timestamp);
            created.push(id);
          }
        }
        row.next_index++; remaining--;
      }
      if (row.next_index !== initialIndex) {
        db.prepare("UPDATE finance_schedules SET next_index=? WHERE id=?").run(row.next_index, row.id);
        advanced.push(row.id);
      }
    }
    const result = { created_count: created.length, has_more: rows.some(row => needsOccurrence(row, through)) };
    return { result, affectedIds: [...advanced, ...created], before: null, after: { ...result, through_date: through, plans: created.map(id => readPlan(id, true)) } };
  });
}
export function skipPlans(actor: FinanceActor, input: unknown): SkippedPlans {
  authorizeFinance(actor, "finance:write");
  const { request_id, ...payload } = parseFinance(skipPlansSchema, input);
  return financeMutation(actor, request_id, "plan.bulk_skip", payload, () => {
    const before = payload.plans.map(plan => pendingPlan(plan.id, plan.version)), db = getDb();
    for (const plan of before) db.prepare("UPDATE finance_plans SET status='cancelled',cancel_reason='skipped',version=version+1,updated_at=? WHERE id=?").run(now(), plan.id);
    const plans = before.map(plan => readPlan(plan.id));
    return { result: { plans }, affectedIds: plans.map(plan => plan.id), before, after: plans };
  });
}
function setPaused(actor: FinanceActor, id: string, input: unknown, paused: boolean): { schedule: FinanceSchedule } {
  authorizeFinance(actor, "finance:manage"); parseFinance(getScheduleSchema, { id });
  const { request_id, ...payload } = parseFinance(scheduleActionSchema, input);
  return financeMutation(actor, request_id, paused ? "schedule.pause" : "schedule.resume", { id, ...payload }, () => {
    const row = editableSchedule(id, payload.version), before = readSchedule(id, true);
    if (!!row.paused === paused) throw new FinanceError(paused ? "Schedule is already paused" : "Schedule is already active", 409, "invalid_state");
    const nextIndex = paused ? row.next_index : futureIndex(row, payload.resume_after ?? today());
    getDb().prepare("UPDATE finance_schedules SET paused=?,next_index=?,version=version+1,updated_at=? WHERE id=?").run(Number(paused), nextIndex, now(), id);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id], before, after: readSchedule(id, true) };
  });
}
export function pauseSchedule(actor: FinanceActor, id: string, input: unknown) { return setPaused(actor, id, input, true); }
export function resumeSchedule(actor: FinanceActor, id: string, input: unknown) { return setPaused(actor, id, input, false); }
export function updateSchedule(actor: FinanceActor, id: string, input: unknown): { schedule: FinanceSchedule } {
  authorizeFinance(actor, "finance:manage"); parseFinance(getScheduleSchema, { id });
  const { request_id, ...patch } = parseFinance(updateScheduleSchema, input);
  return financeMutation(actor, request_id, "schedule.update", { id, ...patch }, () => {
    const row = editableSchedule(id, patch.version), anchor = pendingPlan(patch.from_plan_id, patch.from_plan_version);
    if (anchor.schedule_id !== id || !anchor.occurrence_date) throw new FinanceError("Select a pending occurrence of this schedule", 400, "invalid_occurrence");
    const before = readSchedule(id, true), db = getDb();
    const cadenceChanged = (patch.interval_count !== undefined && patch.interval_count !== row.interval_count)
      || (patch.interval_unit !== undefined && patch.interval_unit !== row.interval_unit) || (patch.start_date !== undefined && patch.start_date !== row.start_date);
    const after = { ...row, ...patch, amount_cents: patch.amount === undefined ? row.amount_cents : positiveAmount(patch.amount),
      tag_ids: patch.tag_ids === undefined ? row.tag_ids : JSON.stringify(patch.tag_ids),
      start_date: cadenceChanged ? (patch.start_date === undefined || patch.start_date === row.start_date ? anchor.occurrence_date : patch.start_date) : row.start_date };
    if (cadenceChanged && patch.start_date !== undefined && patch.start_date !== row.start_date && after.start_date < anchor.occurrence_date)
      throw new FinanceError("Future recurrence must start on or after the selected occurrence", 400, "invalid_input");
    if (after.end_date && after.end_date < after.start_date) throw new FinanceError("End date must not precede start date", 400, "invalid_input");
    if (after.account_id !== row.account_id) validatePlanAccount(after.account_id);
    if (patch.type !== undefined || patch.category_id !== undefined || patch.subcategory_id !== undefined || patch.tag_ids !== undefined)
      validateTransactionClassifications({ ...after, tag_ids: JSON.parse(after.tag_ids) as string[] });
    const affected = db.prepare("SELECT id,version FROM finance_plans WHERE schedule_id=? AND occurrence_date>=? AND status='pending' ORDER BY occurrence_date,id")
      .all(id, anchor.occurrence_date) as { id: string; version: number }[];
    if (affected.some(plan => plan.version === Number.MAX_SAFE_INTEGER)) throw new FinanceError("Occurrence version limit reached", 409, "version_conflict");
    const beforePlans = affected.map(plan => readPlan(plan.id, true));
    if (cadenceChanged) {
      const claimedDate = db.prepare(`SELECT id FROM finance_plans WHERE schedule_id=? AND occurrence_date=?
        AND id<>? AND status IN ('pending','satisfied') LIMIT 1`).get(id, after.start_date, anchor.id);
      if (claimedDate) throw new FinanceError("Another occurrence already claims this date", 409, "occurrence_conflict");
    }
    const generation = row.generation + Number(cadenceChanged);
    let nextIndex = cadenceChanged ? 1 : row.next_index;
    if (!cadenceChanged && row.end_date && (!after.end_date || after.end_date > row.end_date))
      nextIndex = Math.min(nextIndex, futureIndex(after, row.end_date));
    for (const plan of beforePlans) {
      const cancelReason = cadenceChanged && plan.id !== anchor.id ? "cadence"
        : after.end_date !== null && (plan.id === anchor.id && cadenceChanged ? after.start_date : plan.occurrence_date!) > after.end_date ? "boundary" : null;
      if (cancelReason) db.prepare("UPDATE finance_plans SET status='cancelled',cancel_reason=?,version=version+1,updated_at=? WHERE id=?")
        .run(cancelReason, now(), plan.id);
      else db.prepare(`UPDATE finance_plans SET type=?,account_id=?,amount_cents=?,category_id=?,subcategory_id=?,text=?,tag_ids=?,
        due_date=?,occurrence_date=?,schedule_generation=?,version=version+1,updated_at=? WHERE id=?`)
        .run(after.type, after.account_id, after.amount_cents, after.category_id, after.subcategory_id, after.text, after.tag_ids,
          cadenceChanged ? after.start_date : plan.due_date, cadenceChanged ? after.start_date : plan.occurrence_date,
          cadenceChanged ? generation : row.generation, now(), plan.id);
    }
    db.prepare(`UPDATE finance_schedules SET type=?,account_id=?,amount_cents=?,category_id=?,subcategory_id=?,text=?,tag_ids=?,
      interval_count=?,interval_unit=?,start_date=?,end_date=?,generation=?,next_index=?,version=version+1,updated_at=? WHERE id=?`)
      .run(after.type, after.account_id, after.amount_cents, after.category_id, after.subcategory_id, after.text, after.tag_ids,
        after.interval_count, after.interval_unit, after.start_date, after.end_date, generation, nextIndex, now(), id);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id, ...affected.map(plan => plan.id)],
      before: { schedule: before, plans: beforePlans }, after: { schedule: readSchedule(id, true), plans: affected.map(plan => readPlan(plan.id, true)) } };
  });
}
