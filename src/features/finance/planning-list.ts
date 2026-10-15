import { getDb } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { parseFinance } from "./mutations";
import { scheduleOccurrenceDate } from "./recurrence";
import { listPlanningSchema, type PlanningItem, type PlanningPage } from "./planning-list-types";
import type { FinanceActor } from "./types";

const selection = `WITH pending AS (
  SELECT schedule_id, id, due_date, automatic_eligible,
    ROW_NUMBER() OVER (PARTITION BY schedule_id ORDER BY due_date, id) AS position
  FROM finance_plans WHERE status='pending' AND schedule_id IS NOT NULL
), schedule_pending AS (
  SELECT schedule_id, COUNT(*) AS pending_count,
    SUM(due_date<@as_of) AS overdue_count, SUM(due_date=@as_of) AS due_today_count,
    SUM(due_date<=@as_of AND automatic_eligible=0) AS manual_due_count,
    MIN(due_date) AS next_due_date, MAX(CASE WHEN position=1 THEN id END) AS first_pending_id
  FROM pending GROUP BY schedule_id
), items AS (
  SELECT 'schedule' AS kind, s.id,
    COALESCE(NULLIF(TRIM(s.text),''), c.name, CASE s.type WHEN 'income' THEN 'Income plan' ELSE 'Expense plan' END) AS title,
    s.type, s.amount_cents, a.name AS account_name, s.handling, s.interval_count, s.interval_unit, s.paused,
    COALESCE(p.next_due_date, planning_occurrence_date(s.start_date,s.end_date,s.interval_count,s.interval_unit,
      s.slot_offset,s.max_occurrences,s.total_limit_cents,s.amount_cents,s.next_index)) AS next_due_date,
    COALESCE(p.pending_count,0) AS pending_count, COALESCE(p.overdue_count,0) AS overdue_count,
    COALESCE(p.due_today_count,0) AS due_today_count, COALESCE(p.manual_due_count,0) AS manual_due_count,
    p.first_pending_id, s.automatic_error, NULL AS terminal_status
  FROM finance_schedules s JOIN finance_accounts a ON a.id=s.account_id
    LEFT JOIN finance_classifications c ON c.id=s.category_id LEFT JOIN schedule_pending p ON p.schedule_id=s.id WHERE s.deleted_at IS NULL
  UNION ALL
  SELECT 'one-time', p.id,
    COALESCE(NULLIF(TRIM(p.text),''), c.name, CASE p.type WHEN 'income' THEN 'Income plan' ELSE 'Expense plan' END),
    p.type, p.amount_cents, a.name, CASE p.automatic_eligible WHEN 1 THEN 'automatic' ELSE 'manual' END,
    NULL, NULL, 0, CASE WHEN p.status='pending' THEN p.due_date END,
    p.status='pending', p.status='pending' AND p.due_date<@as_of, p.status='pending' AND p.due_date=@as_of,
    p.status='pending' AND p.due_date<=@as_of AND p.automatic_eligible=0,
    CASE WHEN p.status='pending' THEN p.id END, NULL,
    CASE p.status WHEN 'satisfied' THEN 'recorded' WHEN 'cancelled' THEN 'cancelled' END
  FROM finance_plans p JOIN finance_accounts a ON a.id=p.account_id
    LEFT JOIN finance_classifications c ON c.id=p.category_id WHERE p.schedule_id IS NULL
), filtered AS (
  SELECT kind,id,title,type,amount_cents,account_name,handling,interval_count,interval_unit,paused,next_due_date,
    pending_count,overdue_count,due_today_count,manual_due_count,first_pending_id,automatic_error,
    CASE WHEN terminal_status IS NOT NULL THEN terminal_status WHEN paused=1 THEN 'paused'
    WHEN next_due_date<@as_of THEN 'overdue' WHEN next_due_date=@as_of THEN 'due-today'
    WHEN next_due_date>@as_of THEN 'upcoming' ELSE 'ended' END AS status
  FROM items WHERE @filter='all'
    OR (@filter='attention' AND (manual_due_count>0 OR automatic_error IS NOT NULL
      OR (kind='schedule' AND handling='manual' AND paused=0 AND next_due_date<=@as_of)))
    OR (@filter='upcoming' AND next_due_date>@as_of AND paused=0)
    OR (@filter='paused' AND paused=1)
)`;

type PlanningRow = Omit<PlanningItem, "paused"> & { paused: number };

export function listPlanning(actor: FinanceActor, input: unknown = {}): PlanningPage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listPlanningSchema, input), db = getDb();
  // Keep calendar and cap policy in the recurrence owner while filtering before pagination.
  db.function("planning_occurrence_date", { deterministic: true }, (
    start_date: string, end_date: string | null, interval_count: number, interval_unit: "day" | "week" | "month" | "year",
    slot_offset: number, max_occurrences: number | null, total_limit_cents: number | null, amount_cents: number, next_index: number,
  ) => scheduleOccurrenceDate({ start_date, end_date, interval_count, interval_unit, slot_offset, max_occurrences, total_limit_cents, amount_cents }, next_index));
  return db.transaction(() => {
    const args = { as_of: query.as_of, filter: query.filter };
    const { total } = db.prepare(`${selection} SELECT COUNT(*) AS total FROM filtered`).get(args) as { total: number };
    const rows = db.prepare(`${selection} SELECT * FROM filtered
      ORDER BY next_due_date IS NULL, next_due_date, title, kind, id LIMIT @limit OFFSET @offset`)
      .all({ ...args, limit: query.limit, offset: query.offset }) as PlanningRow[];
    return { items: rows.map(({ paused, ...row }) => ({ ...row, paused: !!paused })),
      total, limit: query.limit, offset: query.offset };
  })();
}
