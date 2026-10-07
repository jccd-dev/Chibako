"use client";

import { useState, type FormEvent } from "react";
import type { FinancePlan } from "./planning-types";
import type { FinanceSchedule } from "./recurrence-types";
import { createScheduleSchema, updateScheduleSchema } from "./recurrence-types";
import type { FinanceActivityController } from "./use-finance-activity";
import type { FinanceRecurrenceController } from "./use-finance-recurrence";
import { decimalPHP, localCalendarDate } from "./presentation";

export function useFinanceScheduleEntry(schedule: FinanceSchedule | null, occurrence: FinancePlan | null, activity: FinanceActivityController, recurrence: FinanceRecurrenceController, onClose: () => void) {
  const source = occurrence ?? schedule;
  const [type, setType] = useState(source?.type ?? "expense");
  const [amount, setAmount] = useState(source ? decimalPHP(source.amount_cents) : "");
  const [account, setAccount] = useState(source?.account_id ?? "");
  const [category, setCategory] = useState(source?.category_id ?? "");
  const [subcategory, setSubcategory] = useState(source?.subcategory_id ?? "");
  const [text, setText] = useState(source?.text ?? "");
  const [association, setAssociation] = useState(source?.obligation_id ?? "");
  const [count, setCount] = useState(String(schedule?.interval_count ?? 1));
  const [unit, setUnit] = useState<FinanceSchedule["interval_unit"]>(schedule?.interval_unit ?? "month");
  const [start, setStart] = useState(occurrence?.occurrence_date ?? schedule?.start_date ?? localCalendarDate());
  const [end, setEnd] = useState(schedule?.end_date ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = !schedule || !!occurrence;
  const categories = activity.classifications.filter(row => row.kind === "category" && row.type === type && !row.parent_id && (!row.archived || row.id === category));
  const subcategories = activity.classifications.filter(row => row.parent_id === category && (!row.archived || row.id === subcategory));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recurrenceChanged = !schedule || Number(count) !== schedule.interval_count || unit !== schedule.interval_unit || start !== (occurrence?.occurrence_date ?? schedule.start_date);
    const fields = { type, amount, account_id: account, category_id: category || null, subcategory_id: subcategory || null, text, tag_ids: source?.tag_ids ?? [], end_date: end || null, obligation_id: association || null,
      ...(recurrenceChanged ? { interval_count: Number(count), interval_unit: unit, start_date: start } : {}) };
    const input = schedule ? { ...fields, version: schedule.version, from_plan_id: occurrence?.id, from_plan_version: occurrence?.version } : fields;
    const parsed = (schedule ? updateScheduleSchema : createScheduleSchema).safeParse({ ...input, request_id: "validate" });
    const nextErrors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0] ?? "end_date")] = issue.message;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { document.getElementById(`schedule-${Object.keys(nextErrors)[0]}`)?.focus(); return; }
    if (await recurrence.save(schedule?.id ?? null, schedule ? "edit" : "create", input)) onClose();
  }

  function changeType(value: string) { setType(value === "income" ? "income" : "expense"); setCategory(""); setSubcategory(""); setAssociation(""); }
  function changeCategory(value: string) { setCategory(value); setSubcategory(""); }
  function changeUnit(value: string) { if (value === "day" || value === "week" || value === "month" || value === "year") setUnit(value); }
  function invalid(key: string) { return { "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `schedule-error-${key}` : undefined }; }

  return { type, amount, setAmount, account, setAccount, category, subcategory, setSubcategory, text, setText, association, setAssociation, count, setCount, unit, changeUnit, start, setStart, end, setEnd, errors, editable, categories, subcategories, submit, changeType, changeCategory, invalid };
}
