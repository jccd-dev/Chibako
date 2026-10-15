import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { financeMutation, parseFinance } from "./mutations";
import { validateTransactionClassifications } from "./activity";
import { occurrenceDate as calendarOccurrenceDate } from "./schedule-calendar";
import { pendingPlan, postPlan, positiveAmount, readPlan, validatePlanAccount, validatePlanObligation } from "./planning";
import { createScheduleSchema, updateScheduleSchema, getScheduleSchema, listSchedulesSchema, scheduleActionSchema, catchUpPlansSchema, skipPlansSchema,
  type FinanceSchedule, type SchedulePage, type CatchUpResult, type SkippedPlans } from "./recurrence-types";

type ScheduleRow = Omit<FinanceSchedule, "currency" | "paused" | "next_due_date" | "tag_ids"> & {
  paused: number; deleted_at: number | null; text: string; tag_ids: string; next_index: number; generation: number; slot_offset: number; created_at: number; updated_at: number;
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
function slotLimit(schedule: Pick<ScheduleRow, "max_occurrences" | "total_limit_cents" | "amount_cents">): number {
  return Math.min(schedule.max_occurrences ?? Infinity,
    schedule.total_limit_cents === null ? Infinity : Math.floor(schedule.total_limit_cents / schedule.amount_cents));
}
function occurrenceDate(schedule: Pick<ScheduleRow, "start_date" | "end_date" | "interval_count" | "interval_unit" | "slot_offset" | "max_occurrences" | "total_limit_cents" | "amount_cents">, index: number): string | null {
  return schedule.slot_offset + index >= slotLimit(schedule) ? null : calendarOccurrenceDate(schedule, index);
}
export { occurrenceDate as scheduleOccurrenceDate };
function occurrenceIndex(schedule: ScheduleRow, date: string): number {
  return futureIndex({ ...schedule, end_date: null, max_occurrences: null, total_limit_cents: null }, date) - 1;
}
function validateAutomatic(actor: FinanceActor, schedule: Pick<ScheduleRow, "handling" | "obligation_id">) {
  if (schedule.handling !== "automatic") return;
  authorizeFinance(actor, "finance:write");
  if (schedule.obligation_id) throw new FinanceError("Obligation reminders require manual handling", 400, "invalid_obligation");
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
  const { text, tag_ids, created_at, updated_at, next_index, paused, ...compact } = row;
  Reflect.deleteProperty(compact, "generation");
  Reflect.deleteProperty(compact, "slot_offset");
  Reflect.deleteProperty(compact, "deleted_at");
  const pending = getDb().prepare("SELECT MIN(CASE WHEN occurrence_date>? THEN occurrence_date END) AS date, COUNT(*) AS count FROM finance_plans WHERE schedule_id=? AND status='pending'")
    .get(today(), row.id) as { date: string | null; count: number };
  return { ...compact, currency: "PHP", paused: !!paused, pending_count: pending.count, next_due_date: pending.date ?? occurrenceDate(row, next_index),
    ...(details ? { text, tag_ids: JSON.parse(tag_ids) as string[], created_at, updated_at } : {}) };
}
function readSchedule(id: string, details = false) { return fromRow(readRow(id), details); }
function editableSchedule(id: string, version: number) {
  const row = readRow(id);
  if (row.deleted_at !== null) throw new FinanceError("Schedule was deleted", 409, "invalid_state");
  if (row.version !== version || row.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Schedule changed; refresh before editing", 409, "version_conflict");
  return row;
}
export function getSchedule(actor: FinanceActor, id: string, input: unknown = {}): FinanceSchedule {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(getScheduleSchema, { ...input as object, id });
  if (readRow(query.id).deleted_at !== null) throw new FinanceError("Schedule not found", 404, "not_found");
  return readSchedule(query.id, query.include_details);
}
export function listSchedules(actor: FinanceActor, input: unknown = {}): SchedulePage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listSchedulesSchema, input), db = getDb();
  const where = query.paused === "all" ? "WHERE s.deleted_at IS NULL" : "WHERE s.deleted_at IS NULL AND s.paused=?", args = query.paused === "all" ? [] : [Number(query.paused === "true")];
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_schedules s ${where}`).get(...args) as { total: number };
    const rows = db.prepare(`${selection} ${where} ORDER BY s.start_date,s.id LIMIT ? OFFSET ?`).all(...args, query.limit, query.offset) as ScheduleRow[];
    return { schedules: rows.map(row => fromRow(row, query.include_details)), total, limit: query.limit, offset: query.offset };
  })();
}
export function createSchedule(actor: FinanceActor, input: unknown): { schedule: FinanceSchedule } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(createScheduleSchema, input), amount = positiveAmount(payload.amount);
  const totalLimit = payload.total_limit === null ? null : positiveAmount(payload.total_limit);
  if (totalLimit !== null && totalLimit < amount) throw new FinanceError("Total must cover at least one payment", 400, "invalid_input");
  validateAutomatic(actor, { ...payload, obligation_id: payload.obligation_id ?? null });
  return financeMutation(actor, request_id, "schedule.create", payload, () => {
    validatePlanAccount(payload.account_id); validateTransactionClassifications(payload); validatePlanObligation(payload.obligation_id, payload.type);
    const id = randomUUID(), timestamp = now();
    getDb().prepare(`INSERT INTO finance_schedules (id,type,account_id,amount_cents,category_id,subcategory_id,text,tag_ids,interval_count,interval_unit,start_date,end_date,paused,created_at,updated_at,obligation_id,handling,max_occurrences,total_limit_cents,logged_time,timezone)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, payload.type, payload.account_id, amount, payload.category_id, payload.subcategory_id, payload.text,
      JSON.stringify(payload.tag_ids), payload.interval_count, payload.interval_unit, payload.start_date, payload.end_date, Number(payload.paused), timestamp, timestamp, payload.obligation_id ?? null, payload.handling, payload.max_occurrences, totalLimit, payload.logged_time, payload.timezone);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id], before: null, after: readSchedule(id, true) };
  });
}
function needsOccurrence(row: ScheduleRow, through: string): boolean {
  const date = occurrenceDate(row, row.next_index);
  if (!date) return false;
  // Keep one upcoming occurrence; advancing the cursor must not add another on every refresh.
  const prior = row.next_index > 0 ? occurrenceDate(row, row.next_index - 1) : null;
  return date <= through || !prior || prior <= through || !!getDb().prepare(
    "SELECT id FROM finance_plans WHERE schedule_id=? AND occurrence_date=? AND status='satisfied' LIMIT 1",
  ).get(row.id, prior);
}
export function catchUpPlans(actor: FinanceActor, input: unknown): CatchUpResult {
  authorizeFinance(actor, "finance:write");
  const { request_id, ...payload } = parseFinance(catchUpPlansSchema, input);
  return financeMutation(actor, request_id, "plan.catch_up", payload, () => {
    const rows = getDb().prepare(`${selection} WHERE s.deleted_at IS NULL AND s.paused=0 ORDER BY s.id`).all() as ScheduleRow[];
    return materializeSchedules(rows, payload.through_date ?? today());
  });
}
function materializeSchedules(rows: ScheduleRow[], through: string, limit = 1000) {
  const db = getDb();
  const created: string[] = [], advanced: string[] = []; let remaining = limit;
  const insert = db.prepare(`INSERT INTO finance_plans (id,type,account_id,amount_cents,due_date,category_id,subcategory_id,text,tag_ids,schedule_id,occurrence_date,schedule_generation,created_at,updated_at,obligation_id,logged_time,timezone,slot_index,automatic_eligible)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
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
            text=?,tag_ids=?,obligation_id=?,logged_time=?,timezone=?,slot_index=?,automatic_eligible=?,status='pending',transaction_id=NULL,schedule_generation=?,cancel_reason=NULL,version=version+1,updated_at=?
            WHERE id=? AND status='cancelled' AND version=?`)
            .run(row.type, row.account_id, row.amount_cents, date, row.category_id, row.subcategory_id, row.text, row.tag_ids, row.obligation_id, row.logged_time, row.timezone, row.slot_offset + row.next_index, Number(row.handling === "automatic"),
              row.generation, timestamp, reopen.id, reopen.version);
          created.push(reopen.id);
        } else if (!current) {
          insert.run(id, row.type, row.account_id, row.amount_cents, date, row.category_id, row.subcategory_id, row.text, row.tag_ids,
            row.id, date, row.generation, timestamp, timestamp, row.obligation_id, row.logged_time, row.timezone, row.slot_offset + row.next_index, Number(row.handling === "automatic"));
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
    if (!paused) {
      validateAutomatic(actor, row);
      if (getDb().prepare("SELECT id FROM finance_plans WHERE schedule_id=? AND status='pending' AND automatic_eligible=1 AND automatic_posted=0 LIMIT 1").get(id))
        authorizeFinance(actor, "finance:write");
    }
    const nextIndex = paused ? row.next_index : futureIndex(row, payload.resume_after ?? today());
    getDb().prepare("UPDATE finance_schedules SET paused=?,next_index=?,version=version+1,updated_at=? WHERE id=?").run(Number(paused), nextIndex, now(), id);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id], before, after: readSchedule(id, true) };
  });
}
export function pauseSchedule(actor: FinanceActor, id: string, input: unknown) { return setPaused(actor, id, input, true); }
export function resumeSchedule(actor: FinanceActor, id: string, input: unknown) { return setPaused(actor, id, input, false); }
export function deleteSchedule(actor: FinanceActor, id: string, input: unknown): { schedule: FinanceSchedule } {
  authorizeFinance(actor, "finance:manage"); parseFinance(getScheduleSchema, { id });
  const { request_id, ...payload } = parseFinance(scheduleActionSchema, input);
  return financeMutation(actor, request_id, "schedule.delete", { id, ...payload }, () => {
    editableSchedule(id, payload.version);
    const db = getDb(), before = readSchedule(id, true);
    const pending = db.prepare("SELECT id,version FROM finance_plans WHERE schedule_id=? AND status='pending'").all(id) as { id: string; version: number }[];
    if (pending.some(plan => plan.version === Number.MAX_SAFE_INTEGER)) throw new FinanceError("Occurrence version limit reached", 409, "version_conflict");
    const beforePlans = pending.map(plan => readPlan(plan.id, true)), timestamp = now();
    db.prepare("UPDATE finance_plans SET status='cancelled',cancel_reason='boundary',automatic_eligible=0,version=version+1,updated_at=? WHERE schedule_id=? AND status='pending'").run(timestamp, id);
    db.prepare("UPDATE finance_schedules SET deleted_at=?,paused=1,automatic_error=NULL,version=version+1,updated_at=? WHERE id=?").run(timestamp, timestamp, id);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id, ...pending.map(plan => plan.id)],
      before: { schedule: before, plans: beforePlans }, after: { schedule: readSchedule(id, true), plans: pending.map(plan => readPlan(plan.id, true)) } };
  });
}
export function updateSchedule(actor: FinanceActor, id: string, input: unknown): { schedule: FinanceSchedule } {
  authorizeFinance(actor, "finance:manage"); parseFinance(getScheduleSchema, { id });
  const { request_id, ...patch } = parseFinance(updateScheduleSchema, input);
  return financeMutation(actor, request_id, "schedule.update", { id, ...patch }, () => {
    const row = editableSchedule(id, patch.version), db = getDb();
    const firstPending = patch.from_plan_id === undefined ? db.prepare("SELECT id,version FROM finance_plans WHERE schedule_id=? AND status='pending' ORDER BY occurrence_date,id LIMIT 1").get(id) as { id: string; version: number } | undefined : undefined;
    const anchor = patch.from_plan_id !== undefined && patch.from_plan_version !== undefined ? pendingPlan(patch.from_plan_id, patch.from_plan_version)
      : firstPending ? pendingPlan(firstPending.id, firstPending.version) : null;
    if (anchor && (anchor.schedule_id !== id || !anchor.occurrence_date)) throw new FinanceError("Select a pending occurrence of this schedule", 400, "invalid_occurrence");
    const before = readSchedule(id, true);
    const anchorDate = anchor?.occurrence_date ?? occurrenceDate(row, row.next_index) ?? today();
    const anchorSlot = anchor ? db.prepare("SELECT slot_index,schedule_generation FROM finance_plans WHERE id=?").get(anchor.id) as { slot_index: number | null; schedule_generation: number }
      : { slot_index: row.slot_offset + row.next_index, schedule_generation: row.generation };
    const retainedLater = db.prepare(`SELECT COUNT(*) AS count FROM finance_plans WHERE schedule_id=? AND occurrence_date>=?
      AND schedule_generation>=? AND id<>? AND (status='satisfied' OR (status='cancelled' AND (cancel_reason='skipped' OR cancel_reason IS NULL)))`)
      .get(id, anchorDate, anchorSlot.schedule_generation, anchor?.id ?? "") as { count: number };
    const cadenceChanged = (patch.interval_count !== undefined && patch.interval_count !== row.interval_count)
      || (patch.interval_unit !== undefined && patch.interval_unit !== row.interval_unit) || (patch.start_date !== undefined && patch.start_date !== row.start_date);
    const after = { ...row, ...patch, amount_cents: patch.amount === undefined ? row.amount_cents : positiveAmount(patch.amount),
      total_limit_cents: patch.total_limit === undefined ? row.total_limit_cents : patch.total_limit === null ? null : positiveAmount(patch.total_limit),
      // Later satisfied/skipped slots survive a cadence edit and still consume its lifetime cap.
      slot_offset: cadenceChanged ? (anchorSlot.slot_index ?? Math.max(0, row.slot_offset + occurrenceIndex(row, anchorDate))) + retainedLater.count : row.slot_offset,
      tag_ids: patch.tag_ids === undefined ? row.tag_ids : JSON.stringify(patch.tag_ids),
      start_date: cadenceChanged ? (patch.start_date === undefined || patch.start_date === row.start_date ? anchorDate : patch.start_date) : row.start_date };
    if (cadenceChanged && patch.start_date !== undefined && patch.start_date !== row.start_date && after.start_date < anchorDate)
      throw new FinanceError("Future recurrence must start on or after the selected occurrence", 400, "invalid_input");
    if (after.end_date && after.end_date < after.start_date) throw new FinanceError("End date must not precede start date", 400, "invalid_input");
    validateAutomatic(actor, after);
    if (after.total_limit_cents !== null && after.total_limit_cents < after.amount_cents)
      throw new FinanceError("Total must cover at least one payment", 400, "invalid_input");
    validatePlanObligation(after.obligation_id, after.type);
    if (after.account_id !== row.account_id) validatePlanAccount(after.account_id);
    if (patch.type !== undefined || patch.category_id !== undefined || patch.subcategory_id !== undefined || patch.tag_ids !== undefined)
      validateTransactionClassifications({ ...after, tag_ids: JSON.parse(after.tag_ids) as string[] });
    const affected = db.prepare("SELECT id,version FROM finance_plans WHERE schedule_id=? AND occurrence_date>=? AND status='pending' ORDER BY occurrence_date,id")
      .all(id, anchorDate) as { id: string; version: number }[];
    if (affected.some(plan => plan.version === Number.MAX_SAFE_INTEGER)) throw new FinanceError("Occurrence version limit reached", 409, "version_conflict");
    const beforePlans = affected.map(plan => readPlan(plan.id, true));
    if (cadenceChanged) {
      const claimedDate = db.prepare(`SELECT id FROM finance_plans WHERE schedule_id=? AND occurrence_date=?
        AND id<>? AND status IN ('pending','satisfied') LIMIT 1`).get(id, after.start_date, anchor?.id ?? "");
      if (claimedDate) throw new FinanceError("Another occurrence already claims this date", 409, "occurrence_conflict");
    }
    const generation = row.generation + Number(cadenceChanged);
    let nextIndex = cadenceChanged ? Number(anchor !== null) : row.next_index;
    if (!cadenceChanged && row.end_date && (!after.end_date || after.end_date > row.end_date))
      nextIndex = Math.min(nextIndex, futureIndex(after, row.end_date));
    // Revisit boundary cancellations when a slot budget grows, without reviving skips.
    if (!cadenceChanged && slotLimit(after) > slotLimit(row)) nextIndex = Math.min(nextIndex, Math.max(0, slotLimit(row) - row.slot_offset));
    for (const plan of beforePlans) {
      const date = plan.id === anchor?.id && cadenceChanged ? after.start_date : plan.occurrence_date!;
      const savedSlot = db.prepare("SELECT slot_index FROM finance_plans WHERE id=?").get(plan.id) as { slot_index: number | null };
      const slot = cadenceChanged ? after.slot_offset : savedSlot.slot_index ?? Math.max(0, after.slot_offset + occurrenceIndex(after, date));
      const cancelReason = cadenceChanged && plan.id !== anchor?.id ? "cadence"
        : (after.end_date !== null && date > after.end_date) || slot >= slotLimit(after) ? "boundary" : null;
      if (cancelReason) db.prepare("UPDATE finance_plans SET status='cancelled',cancel_reason=?,version=version+1,updated_at=? WHERE id=?")
        .run(cancelReason, now(), plan.id);
      else db.prepare(`UPDATE finance_plans SET type=?,account_id=?,amount_cents=?,category_id=?,subcategory_id=?,text=?,tag_ids=?,
        due_date=?,occurrence_date=?,schedule_generation=?,obligation_id=?,logged_time=?,timezone=?,slot_index=?,automatic_eligible=?,version=version+1,updated_at=? WHERE id=?`)
        .run(after.type, after.account_id, after.amount_cents, after.category_id, after.subcategory_id, after.text, after.tag_ids,
          cadenceChanged ? after.start_date : plan.due_date, cadenceChanged ? after.start_date : plan.occurrence_date,
          cadenceChanged ? generation : row.generation, after.obligation_id, after.logged_time, after.timezone, slot, Number(after.handling === "automatic"), now(), plan.id);
    }
    db.prepare(`UPDATE finance_schedules SET type=?,account_id=?,amount_cents=?,category_id=?,subcategory_id=?,text=?,tag_ids=?,
      interval_count=?,interval_unit=?,start_date=?,end_date=?,generation=?,next_index=?,obligation_id=?,handling=?,max_occurrences=?,total_limit_cents=?,slot_offset=?,logged_time=?,timezone=?,automatic_error=NULL,version=version+1,updated_at=? WHERE id=?`)
      .run(after.type, after.account_id, after.amount_cents, after.category_id, after.subcategory_id, after.text, after.tag_ids,
        after.interval_count, after.interval_unit, after.start_date, after.end_date, generation, nextIndex, after.obligation_id, after.handling, after.max_occurrences, after.total_limit_cents, after.slot_offset, after.logged_time, after.timezone, now(), id);
    return { result: { schedule: readSchedule(id) }, affectedIds: [id, ...affected.map(plan => plan.id)],
      before: { schedule: before, plans: beforePlans }, after: { schedule: readSchedule(id, true), plans: affected.map(plan => readPlan(plan.id, true)) } };
  });
}

function localClock(at: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}
function isDue(plan: { due_date: string; logged_time: string; timezone: string }, at: Date): boolean {
  const clock = localClock(at, plan.timezone);
  return plan.due_date < clock.date || (plan.due_date === clock.date && plan.logged_time <= clock.time);
}
let automaticCursor = "";
export function processAutomaticSchedules(at = new Date()): { posted_count: number; failed_count: number; has_more: boolean } {
  if (!Number.isFinite(at.getTime())) throw new FinanceError("Invalid processing time", 400, "invalid_input");
  const actor: FinanceActor = { kind: "trusted-local" }, db = getDb();
  const rows = db.prepare(`${selection} WHERE s.deleted_at IS NULL AND s.paused=0 AND s.id>? AND (s.handling='automatic' OR EXISTS (SELECT 1 FROM finance_plans p WHERE p.schedule_id=s.id AND p.status='pending' AND p.automatic_eligible=1 AND p.automatic_posted=0)) ORDER BY s.id LIMIT 100`).all(automaticCursor) as ScheduleRow[];
  automaticCursor = rows.length === 100 ? rows[rows.length - 1].id : "";
  let posted_count = 0, failed_count = 0, has_more = rows.length === 100;
  for (const snapshot of rows) {
    try {
      const generated = db.transaction(() => {
        const row = readRow(snapshot.id);
        if (row.deleted_at !== null || row.paused || row.handling !== "automatic") return null;
        const through = localClock(at, row.timezone).date;
        if (!needsOccurrence(row, through)) return null;
        return financeMutation(actor, randomUUID(), "schedule.automatic_generate", { schedule_id: row.id, through_date: through }, () => materializeSchedules([row], through, 100));
      }).immediate();
      has_more ||= generated?.has_more ?? false;
      const pending = db.prepare("SELECT id FROM finance_plans WHERE schedule_id=? AND status='pending' AND automatic_posted=0 AND automatic_eligible=1 ORDER BY due_date,id LIMIT 101")
        .all(snapshot.id) as { id: string }[];
      has_more ||= pending.length > 100;
      for (const { id } of pending.slice(0, 100)) {
        const posted = db.transaction(() => {
          const row = readRow(snapshot.id), plan = readPlan(id, true);
          const marker = db.prepare("SELECT automatic_posted,automatic_eligible FROM finance_plans WHERE id=?").get(id) as { automatic_posted: number; automatic_eligible: number };
          if (row.deleted_at !== null || row.paused || !marker.automatic_eligible || plan.status !== "pending" || marker.automatic_posted || !isDue(plan, at)) return false;
          if (plan.obligation_id) throw new FinanceError("Obligation reminders require manual handling", 400, "invalid_obligation");
          postPlan(actor, id, { request_id: `automatic-plan:${id}`, version: plan.version, account_id: plan.account_id,
            amount: `${Math.floor(plan.amount_cents / 100)}.${String(plan.amount_cents % 100).padStart(2, "0")}`, transaction_date: plan.due_date });
          return true;
        }).immediate();
        posted_count += Number(posted);
      }
      db.prepare("UPDATE finance_schedules SET automatic_error=NULL WHERE id=?").run(snapshot.id);
    } catch (error) {
      const message = error instanceof FinanceError ? error.message : "Automatic posting failed. Review this plan or switch to manual handling.";
      db.prepare("UPDATE finance_schedules SET automatic_error=? WHERE id=?").run(message.slice(0, 300), snapshot.id);
      failed_count++;
    }
  }
  return { posted_count, failed_count, has_more };
}
