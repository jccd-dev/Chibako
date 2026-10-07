"use client";

import { useEffect, useState } from "react";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinanceSchedule } from "@/features/finance/recurrence-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import { useFinanceRecurrence, type FinanceRecurrenceController } from "@/features/finance/use-finance-recurrence";
import { financeJson } from "@/features/finance/client-json";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP as money } from "@/features/finance/presentation";
import { Button } from "@/components/ui/button";
import { FinanceDateInput } from "./FinanceDateInputs";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { FinanceOptionStatus } from "./FinanceActivity";
import { useFinanceScheduleEntry } from "@/features/finance/use-finance-schedule-entry";

export function FinanceRecurrence({ activity, planning, occurrence, onCloseOccurrence }: { activity: FinanceActivityController; planning: FinancePlanningController; occurrence: FinancePlan | null; onCloseOccurrence: () => void }) {
  const recurrence = useFinanceRecurrence(planning.notice, planning);
  const [panel, setPanel] = useState<string | null>(null);
  const [detail, setDetail] = useState<FinanceSchedule | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => { if (occurrence?.schedule_id) { recurrence.resetSave(); setPanel(occurrence.schedule_id); } }, [occurrence]);
  useEffect(() => {
    setDetail(null); setError("");
    if (!panel || panel === "create") return;
    const abort = new AbortController();
    void fetch(`/api/finance/schedules/${panel}?include_details=true`, { signal: abort.signal }).then(financeJson<{ schedule: FinanceSchedule }>).then(result => { if (!abort.signal.aborted) setDetail(result.schedule); }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Could not inspect schedule."); });
    return () => abort.abort();
  }, [panel, reload]);
  function close() { setPanel(null); onCloseOccurrence(); }
  function open(id: string) { onCloseOccurrence(); recurrence.resetSave(); setPanel(id); }
  return <section aria-label="Recurring schedules" className="mt-8 border-t border-border pt-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Recurring schedules</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Every due occurrence waits for review below. Nothing posts automatically.</p></div><Button className={control} onClick={() => open("create")}>Add recurring schedule</Button></div>
    {recurrence.notice && <p role="status" className="mt-4 text-sm">{recurrence.notice}</p>}
    <Field className="my-5 sm:max-w-xs"><FieldLabel htmlFor="schedule-status">Schedule status</FieldLabel><select id="schedule-status" className={select} value={recurrence.paused} onChange={event => recurrence.changePaused(event.target.value)}><option value="all">All schedules</option><option value="false">Active</option><option value="true">Paused</option></select></Field>
    {recurrence.error ? <Alert className="mt-4"><AlertDescription>{recurrence.error}<Button variant="outline" className={control} onClick={() => void recurrence.refresh()}>Retry schedules</Button></AlertDescription></Alert> : recurrence.loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading schedules…</p> : recurrence.page?.schedules.length ? <ul className="mt-4 divide-y divide-border">{recurrence.page.schedules.map(schedule => <li key={schedule.id}><button className="flex min-h-11 w-full flex-wrap justify-between gap-3 rounded-md py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => open(schedule.id)}><span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{schedule.text || schedule.category_name || "Uncategorized"}</span><span className="mt-1 block text-sm text-muted-foreground">Every {schedule.interval_count} {schedule.interval_unit}{schedule.interval_count === 1 ? "" : "s"} · {schedule.paused ? "Paused" : "Active"}{schedule.next_due_date ? ` · Next ${schedule.next_due_date}` : ""}</span></span><span className="text-right text-sm">{schedule.type}<strong className="block tabular-nums">{money(schedule.amount_cents)}</strong></span></button></li>)}</ul> : <p className="py-6 text-sm text-muted-foreground">No recurring schedules. Add expected income or expenses that repeat.</p>}
    {recurrence.page && recurrence.page.total > 25 && <nav aria-label="Schedule pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!recurrence.offset || recurrence.loading} onClick={() => recurrence.setOffset(Math.max(0, recurrence.offset - 25))}>Previous schedules</Button><span className="text-sm">{recurrence.offset + 1}-{Math.min(recurrence.offset + 25, recurrence.page.total)} of {recurrence.page.total}</span><Button variant="outline" className={control} disabled={recurrence.loading || recurrence.offset + 25 >= recurrence.page.total} onClick={() => recurrence.setOffset(recurrence.offset + 25)}>Next schedules</Button></nav>}
    <Sheet open={panel !== null} onOpenChange={value => { if (!value && !recurrence.busy) close(); }}><SheetContent className={financeSheet} showCloseButton={false}><SheetHeader className="border-b border-border p-6"><SheetTitle>{panel === "create" ? "Add recurring schedule" : occurrence ? "Edit this and future occurrences" : "Review recurring schedule"}</SheetTitle><SheetDescription>Schedules create pending expectations. Posted history and balances stay unchanged.</SheetDescription></SheetHeader>
      {error ? <div className="flex flex-col gap-4 p-6"><Alert><AlertDescription>{error}</AlertDescription></Alert><Button variant="outline" className={control} onClick={() => setReload(value => value + 1)}>Retry schedule inspection</Button><Button variant="outline" className={control} onClick={close}>Close schedule</Button></div> : panel === "create" || detail ? <SchedulePanel key={`${panel}:${detail?.version ?? "new"}:${reload}`} schedule={detail} occurrence={occurrence} activity={activity} recurrence={recurrence} onClose={close} onRefresh={() => { recurrence.resetSave(); setReload(value => value + 1); }} /> : <div className="flex flex-col gap-4 p-6"><p role="status">Loading schedule…</p><Button variant="outline" className={control} onClick={close}>Close schedule</Button></div>}
    </SheetContent></Sheet>
  </section>;
}

function SchedulePanel({ schedule, occurrence, activity, recurrence, onClose, onRefresh }: { schedule: FinanceSchedule | null; occurrence: FinancePlan | null; activity: FinanceActivityController; recurrence: FinanceRecurrenceController; onClose: () => void; onRefresh: () => void }) {
  const { type, amount, setAmount, account, setAccount, category, subcategory, setSubcategory, text, setText, count, setCount, unit, changeUnit, start, setStart, end, setEnd, errors, editable, categories, subcategories, submit, changeType, changeCategory, invalid } = useFinanceScheduleEntry(schedule, occurrence, activity, recurrence, onClose);
  return <div className="flex flex-1 flex-col gap-5 p-6">
    {schedule && <><p className="text-sm">{schedule.paused ? "Paused" : "Active"} · Every {schedule.interval_count} {schedule.interval_unit}(s). Start {schedule.start_date}{schedule.end_date ? `, end ${schedule.end_date}` : ", no end date"}.<br />Expected {schedule.type}: {money(schedule.amount_cents)} in {schedule.account_name}.</p><p className="break-words text-sm text-muted-foreground">{schedule.text || schedule.category_name || "Uncategorized"}</p></>}
    {editable ? <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {occurrence && <p className="text-sm">Changes apply from the occurrence due {occurrence.due_date}. To change only that occurrence, return to its review.</p>}
      <Field><FieldLabel htmlFor="schedule-type">Schedule type</FieldLabel><select id="schedule-type" className={select} value={type} disabled={recurrence.busy} onChange={event => changeType(event.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></Field>
      <Field><FieldLabel htmlFor="schedule-amount">Expected amount (PHP)</FieldLabel><Input id="schedule-amount" inputMode="decimal" className={control} value={amount} disabled={recurrence.busy} onChange={event => setAmount(event.target.value)} {...invalid("amount")} /><FieldError id="schedule-error-amount">{errors.amount}</FieldError></Field>
      <Field><FieldLabel htmlFor="schedule-account_id">Expected account</FieldLabel><select id="schedule-account_id" className={select} value={account} disabled={recurrence.busy} onChange={event => setAccount(event.target.value)} {...invalid("account_id")}><option value="">Choose a money account</option>{activity.accounts.filter(row => row.kind === "money" && (!row.archived || row.id === account)).map(row => <option key={row.id} value={row.id}>{row.name}{row.archived ? " (archived)" : ""}</option>)}</select><FieldError id="schedule-error-account_id">{errors.account_id}</FieldError></Field>
      <div className="grid grid-cols-2 gap-4"><Field><FieldLabel htmlFor="schedule-interval_count">Every</FieldLabel><Input id="schedule-interval_count" type="number" min="1" max="10000" className={control} value={count} disabled={recurrence.busy} onChange={event => setCount(event.target.value)} {...invalid("interval_count")} /><FieldError id="schedule-error-interval_count">{errors.interval_count}</FieldError></Field><Field><FieldLabel htmlFor="schedule-interval_unit">Interval</FieldLabel><select id="schedule-interval_unit" className={select} value={unit} disabled={recurrence.busy} onChange={event => changeUnit(event.target.value)}><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></select></Field></div>
      <Field><FieldLabel htmlFor="schedule-start_date">Start date</FieldLabel><FinanceDateInput id="schedule-start_date" min="1000-01-01" max="9999-12-31" value={start} disabled={recurrence.busy} onChange={setStart} {...invalid("start_date")} /><FieldDescription>Monthly dates past month-end use the final day of that month.</FieldDescription><FieldError id="schedule-error-start_date">{errors.start_date}</FieldError></Field>
      <Field><FieldLabel htmlFor="schedule-end_date">End date (optional)</FieldLabel><FinanceDateInput id="schedule-end_date" min="1000-01-01" max="9999-12-31" value={end} disabled={recurrence.busy} onChange={setEnd} {...invalid("end_date")} /><FieldError id="schedule-error-end_date">{errors.end_date}</FieldError></Field>
      <Field><FieldLabel htmlFor="schedule-category">Category</FieldLabel><select id="schedule-category" className={select} value={category} disabled={recurrence.busy} onChange={event => changeCategory(event.target.value)}><option value="">Uncategorized</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
      {!!subcategories.length && <Field><FieldLabel htmlFor="schedule-subcategory">Subcategory</FieldLabel><select id="schedule-subcategory" className={select} value={subcategory} disabled={recurrence.busy} onChange={event => setSubcategory(event.target.value)}><option value="">No subcategory</option>{subcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
      <Field><FieldLabel htmlFor="schedule-text">Schedule text (optional)</FieldLabel><Input id="schedule-text" maxLength={2000} className={control} value={text} disabled={recurrence.busy} onChange={event => setText(event.target.value)} /></Field><FinanceOptionStatus activity={activity} />
      <Button type="submit" className={`${control} self-end`} disabled={recurrence.busy}>{recurrence.busy ? "Saving…" : schedule ? "Save this and future changes" : "Save recurring schedule"}</Button>
    </form> : <p className="text-sm text-muted-foreground">To edit a schedule, choose a pending occurrence below, then Edit this and future occurrences. Existing posted history stays preserved.</p>}
    {schedule && !occurrence && <section className="flex flex-col gap-4"><p className="text-sm">{schedule.paused ? "Review the schedule before resuming. Resume starts at the next future due date; existing pending review stays available." : "Pausing stops new occurrences and keeps existing pending review."}</p><Button className={control} disabled={recurrence.busy} onClick={() => void recurrence.save(schedule.id, schedule.paused ? "resume" : "pause", { version: schedule.version }).then(result => { if (result) onClose(); })}>{recurrence.busy ? "Saving…" : schedule.paused ? "Reviewed schedule: resume" : "Confirm pause"}</Button></section>}
    {recurrence.saveError && <Alert><AlertDescription>{recurrence.saveError} Retry unchanged fields for a safe request retry.{schedule && <Button variant="outline" className={control} disabled={recurrence.busy} onClick={onRefresh}>Refresh schedule before editing</Button>}</AlertDescription></Alert>}
    <Button variant="outline" className={`${control} mt-auto self-end`} disabled={recurrence.busy} onClick={onClose}>Close schedule</Button>
  </div>;
}
