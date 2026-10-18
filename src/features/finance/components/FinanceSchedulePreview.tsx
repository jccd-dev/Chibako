import { format } from "date-fns";
import type { FinanceSchedule } from "../recurrence-types";
import type { FinancePlan } from "../planning-types";
import type { FinanceScheduleEntry } from "../use-finance-schedule-entry";
import { occurrenceDate, nextOccurrenceDate } from "../schedule-calendar";
import { decimalCents } from "../money";

type PreviewFields = Pick<FinanceScheduleEntry, "recurring" | "start" | "loggedDate" | "count" | "unit" | "endCondition" | "end" | "amount" | "total" | "payments" | "type" | "time" | "timezone" | "handling">;

export function FinanceSchedulePreview({ form, schedule, occurrence }: { form: PreviewFields; schedule: Pick<FinanceSchedule, "start_date" | "interval_count" | "interval_unit"> | null; occurrence: Pick<FinancePlan, "occurrence_date"> | null }) {
  const { recurring, start, loggedDate, count, unit, endCondition, end, amount, total, payments, type, time, timezone, handling } = form;
  const cadenceUnchanged = schedule && Number(count) === schedule.interval_count && unit === schedule.interval_unit && start === (occurrence?.occurrence_date ?? schedule.start_date);
  const calendar = { start_date: cadenceUnchanged ? schedule.start_date : start, end_date: endCondition === "date" ? end || null : null, interval_count: Number(count), interval_unit: unit };
  const first = occurrenceDate(recurring ? { ...calendar, start_date: start } : { start_date: loggedDate, end_date: null, interval_count: 1, interval_unit: "day" }, 0);
  let next = first && recurring ? nextOccurrenceDate(calendar, first) : null;
  let limit: number | null = null;
  if (recurring && endCondition === "payments") limit = Number(payments);
  if (recurring && endCondition === "total" && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(total) && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) {
    try { const cents = decimalCents(amount); if (cents > 0) limit = Number(BigInt(decimalCents(total)) / BigInt(cents)); } catch { limit = 0; }
  }
  if (limit !== null && limit < 2 && !schedule) next = null;
  const limitedEdit = !!schedule && limit !== null;
  const dateLabel = (date: string) => format(new Date(`${date}T12:00:00`), "MMMM d, yyyy");
  return <section aria-labelledby="schedule-preview-title" aria-live="polite" className="rounded-xl bg-muted/50 p-4">
    <h3 id="schedule-preview-title" className="text-sm font-medium">Schedule preview</h3>
    <p className="mt-2 text-sm leading-relaxed">{!first || limit !== null && limit < 1 ? "Choose a valid date, repeat interval and limit to preview your schedule." : recurring ? <>This {schedule ? "updates the" : "becomes the first"} recurring {type} {schedule ? "from" : "on"} {dateLabel(first)}. {limitedEdit ? "Remaining occurrences respect the lifetime limit and retained history." : next ? `The next one follows on ${dateLabel(next)}.` : "No further occurrence follows within this schedule’s limits."}</> : <>This {type} is planned for {dateLabel(first)}. It stays pending until you confirm it.</>}</p>
    {recurring && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{handling === "automatic" ? `Automatic processing from ${time || "00:00"} (${timezone}).` : "Manual confirmation required."} {(unit === "month" || unit === "year") && "Dates past month-end use that month’s final day."}</p>}
  </section>;
}
