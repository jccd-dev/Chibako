"use client";

import { useRef, useState, type FormEvent } from "react";
import { createPlanSchema, type FinancePlan } from "./planning-types";
import type { FinanceSchedule } from "./recurrence-types";
import { createScheduleSchema, updateScheduleSchema } from "./recurrence-types";
import type { FinanceActivityController } from "./use-finance-activity";
import type { FinancePlanningController } from "./use-finance-planning";
import type { FinanceRecurrenceController } from "./use-finance-recurrence";
import { decimalPHP, localCalendarDate } from "./presentation";
import { decimalCents } from "./money";
import { repeatPreset, repeatPresets } from "./repeat-presets";

type EndCondition = "forever" | "date" | "payments" | "total";

export function useFinanceScheduleEntry(schedule: FinanceSchedule | null, occurrence: FinancePlan | null, activity: FinanceActivityController, recurrence: FinanceRecurrenceController, planning: FinancePlanningController, onClose: () => void, onBusyChange: (busy: boolean) => void, initialRecurring = true, editMode = false) {
  const source = occurrence ?? schedule;
  const [type, setType] = useState(source?.type ?? "expense");
  const [amount, setAmount] = useState(source ? decimalPHP(source.amount_cents) : "");
  const [account, setAccount] = useState(source?.account_id ?? "");
  const [category, setCategory] = useState(source?.category_id ?? "");
  const [subcategory, setSubcategory] = useState(source?.subcategory_id ?? "");
  const [text, setText] = useState(source?.text ?? "");
  const [association, setAssociation] = useState(source?.obligation_id ?? "");
  const [recurring, setRecurring] = useState(initialRecurring);
  const [count, setCount] = useState(String(schedule?.interval_count ?? 1));
  const [unit, setUnit] = useState<FinanceSchedule["interval_unit"]>(schedule?.interval_unit ?? "month");
  const [preset, setPreset] = useState(() => repeatPreset(Number(count), unit));
  const [loggedDate, setLoggedDate] = useState(occurrence?.occurrence_date ?? schedule?.start_date ?? localCalendarDate());
  const [time, setTime] = useState(source?.logged_time ?? new Date().toTimeString().slice(0, 5));
  const [timezone] = useState(source?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [startLater, setStartLater] = useState(false);
  const [laterDate, setLaterDate] = useState(loggedDate);
  const initialEndCondition: EndCondition = schedule?.max_occurrences ? "payments" : schedule?.total_limit_cents ? "total" : schedule?.end_date ? "date" : "forever";
  const [endCondition, setEndCondition] = useState<EndCondition>(initialEndCondition);
  const [end, setEnd] = useState(schedule?.end_date ?? "");
  const [payments, setPayments] = useState(String(schedule?.max_occurrences ?? 12));
  const [total, setTotal] = useState(schedule?.total_limit_cents ? decimalPHP(schedule.total_limit_cents) : "");
  const [handling, setHandling] = useState<"manual" | "automatic">(schedule?.handling ?? "manual");
  const submitting = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = !schedule || !!occurrence || editMode;
  const busy = recurrence.busy || planning.busy || activity.busy;
  const start = startLater ? laterDate : loggedDate;
  const subcategories = activity.classifications.filter(row => row.parent_id === category && (!row.archived || row.id === subcategory));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const common = { type, amount, account_id: account, category_id: category || null, subcategory_id: subcategory || null, text, tag_ids: source?.tag_ids ?? [], logged_time: time, timezone };
    const recurrenceChanged = !schedule || Number(count) !== schedule.interval_count || unit !== schedule.interval_unit || start !== (occurrence?.occurrence_date ?? schedule.start_date);
    const limits = { end_date: endCondition === "date" ? end || null : null, max_occurrences: endCondition === "payments" ? Number(payments) : null, total_limit: endCondition === "total" ? total : null };
    const endingUnchanged = schedule && endCondition === initialEndCondition && (endCondition === "date" ? end === schedule.end_date : endCondition === "payments" ? Number(payments) === schedule.max_occurrences : endCondition === "total" ? schedule.total_limit_cents !== null && total === decimalPHP(schedule.total_limit_cents) : true);
    const preservedLimits = endingUnchanged ? { end_date: schedule.end_date, max_occurrences: schedule.max_occurrences, total_limit: schedule.total_limit_cents === null ? null : decimalPHP(schedule.total_limit_cents) } : limits;
    const fields = recurring ? { ...common, ...preservedLimits, handling, obligation_id: association || null,
      ...(recurrenceChanged ? { interval_count: Number(count), interval_unit: unit, start_date: start } : {}) } : { ...common, due_date: loggedDate };
    const input = schedule ? { ...fields, version: schedule.version, from_plan_id: occurrence?.id, from_plan_version: occurrence?.version } : fields;
    const schema = recurring ? schedule ? updateScheduleSchema : createScheduleSchema : createPlanSchema;
    const parsed = schema.safeParse({ ...input, request_id: "validate" });
    const nextErrors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0] ?? "end_date")] = issue.message;
    try { if (decimalCents(amount) <= 0) nextErrors.amount = "Enter a positive PHP amount."; } catch { nextErrors.amount = "Enter a valid PHP amount."; }
    if (recurring && endCondition === "date" && !end) nextErrors.end_date = "Choose the last date for this plan.";
    if (recurring && startLater && laterDate < loggedDate) nextErrors.start_date = "Choose a start on or after the logged date.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { const key = Object.keys(nextErrors)[0]; document.getElementById(key === "due_date" || key === "start_date" && !startLater ? "schedule-logged-date" : `schedule-${key}`)?.focus(); return; }
    submitting.current = true; onBusyChange(true);
    try {
      const result = recurring ? await recurrence.save(schedule?.id ?? null, schedule ? "edit" : "create", input) : await planning.save(null, "create", input);
      if (!result) return;
      onClose();
    } catch (error) { setErrors({ submit: error instanceof Error ? error.message : "Could not save the plan. Try again." }); }
    finally { submitting.current = false; onBusyChange(false); }
  }

  function changeType(value: string) {
    setType(value === "income" ? "income" : "expense"); setCategory(""); setSubcategory(""); setAssociation("");
    if (value === "income" && (endCondition === "payments" || endCondition === "total")) setEndCondition("forever");
  }
  function changeCategory(value: string) { setCategory(value); setSubcategory(""); }
  function changeUnit(value: string) { if (value === "day" || value === "week" || value === "month" || value === "year") setUnit(value); }
  function changePreset(value: string) {
    setPreset(value);
    const selected = repeatPresets.find(preset => preset.value === value);
    if (selected) { setCount(String(selected.count)); setUnit(selected.unit); }
  }
  function changeAssociation(value: string) { setAssociation(value); if (value) setHandling("manual"); }
  function changeEndCondition(value: string) { if (value === "forever" || value === "date" || value === "payments" || value === "total") setEndCondition(value); }
  function invalid(key: string) { return { "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `schedule-error-${key}` : undefined }; }

  return { type, amount, setAmount, account, setAccount, category, subcategory, setSubcategory, text, setText, association, changeAssociation, recurring, setRecurring, count, setCount, unit, changeUnit, preset, changePreset, loggedDate, setLoggedDate, time, setTime, timezone, start, startLater, setStartLater, laterDate, setLaterDate, end, setEnd, endCondition, changeEndCondition, payments, setPayments, total, setTotal, handling, setHandling, errors, editable, subcategories, submit, changeType, changeCategory, invalid, busy };
}
export type FinanceScheduleEntry = ReturnType<typeof useFinanceScheduleEntry>;
