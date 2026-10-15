"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinanceSchedule } from "@/features/finance/recurrence-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import { useFinanceRecurrence, type FinanceRecurrenceController } from "@/features/finance/use-finance-recurrence";
import { financeJson } from "@/features/finance/client-json";
import { financeSheet, formatPHP as money, localCalendarDate } from "@/features/finance/presentation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FinancePlanningForm } from "./FinancePlanningForm";
import { FinanceSchedulePayments } from "./FinanceSchedulePayments";
import type { ReminderOptions } from "./FinancePlans";

function humanDate(iso: string) {
  return format(new Date(`${iso}T12:00:00`), "MMMM d, yyyy");
}

function cadence(schedule: FinanceSchedule) {
  const { interval_count: count, interval_unit: unit } = schedule;
  if (count === 1) return { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[unit];
  return `Every ${count} ${unit}s`;
}

export function FinanceRecurrence({ activity, planning, selection, onCloseSelection, occurrence, onCloseOccurrence, renderPayment, reminders }: { activity: FinanceActivityController; planning: FinancePlanningController; selection: string | null; onCloseSelection: () => void; occurrence: FinancePlan | null; onCloseOccurrence: () => void; renderPayment: (plan: FinancePlan, onDone: () => void, onRefresh: () => void) => ReactNode; reminders: ReminderOptions }) {
  const recurrence = useFinanceRecurrence(planning);
  const [previousSelection, setPreviousSelection] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [panel, setPanel] = useState<string | null>(occurrence?.schedule_id ?? null);
  const [detailState, setDetail] = useState<{ key: string; value: FinanceSchedule } | null>(null);
  const [errorState, setError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [previousOccurrenceId, setPreviousOccurrenceId] = useState(occurrence?.schedule_id);
  const detailKey = `${panel ?? ""}:${reload}`;
  const detail = detailState?.key === detailKey ? detailState.value : null;
  const error = errorState?.key === detailKey ? errorState.message : "";
  const { resetSave } = recurrence;
  if (previousOccurrenceId !== occurrence?.schedule_id) {
    setPreviousOccurrenceId(occurrence?.schedule_id);
    if (occurrence?.schedule_id) { setReload(value => value + 1); setPanel(occurrence.schedule_id); }
  }
  if (previousSelection !== selection) {
    setPreviousSelection(selection);
    if (selection) { setReload(value => value + 1); setPanel(selection); }
  }
  useEffect(() => { if (selection) resetSave(); }, [selection, resetSave]);
  useEffect(() => { if (occurrence?.schedule_id) resetSave(); }, [occurrence?.schedule_id, resetSave]);
  useEffect(() => {
    if (!panel || panel === "create") return;
    const abort = new AbortController();
    void fetch(`/api/finance/schedules/${panel}?include_details=true`, { signal: abort.signal }).then(financeJson<{ schedule: FinanceSchedule }>).then(result => { if (!abort.signal.aborted) setDetail({ key: detailKey, value: result.schedule }); }).catch(e => { if (!abort.signal.aborted) setError({ key: detailKey, message: e instanceof Error ? e.message : "Could not inspect schedule." }); });
    return () => abort.abort();
  }, [panel, reload, detailKey]);
  function close() { setPanel(null); onCloseSelection(); onCloseOccurrence(); }
  return <>
    {recurrence.notice && <p role="status" className="mt-4 text-sm">{recurrence.notice}</p>}
    {recurrence.saveError && !panel && <Alert className="mt-4"><AlertDescription>{recurrence.saveError}</AlertDescription></Alert>}
    <Sheet open={panel !== null} onOpenChange={value => { if (!value && !recurrence.busy && !planning.busy && !formBusy && !activity.busy) close(); }}><SheetContent className={`${financeSheet} overscroll-contain`}>
      <SheetHeader className="border-b border-border p-4 pr-10"><SheetTitle>{panel === "create" ? "Add income or expense plan" : occurrence ? "Edit this and future occurrences" : detail?.type === "income" ? "Recurring income plan" : "Recurring expense plan"}</SheetTitle><SheetDescription>{panel === "create" || occurrence ? "Choose when and how this plan repeats." : "Summary, payments, and schedule actions."}</SheetDescription></SheetHeader>
      {error ? <div className="flex flex-col gap-4 p-4"><Alert><AlertDescription>{error}</AlertDescription></Alert><Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry schedule inspection</Button><Button variant="outline" onClick={close}>Close schedule</Button></div> : panel === "create" || detail ? <SchedulePanel key={`${panel}:${detail?.version ?? "new"}:${reload}`} schedule={detail} occurrence={occurrence} activity={activity} recurrence={recurrence} planning={planning} reminders={reminders} onClose={close} renderPayment={renderPayment} onBusyChange={setFormBusy} onRefresh={() => { recurrence.resetSave(); setReload(value => value + 1); }} /> : <div className="flex flex-col gap-4 p-4"><p role="status">Loading schedule…</p><Button variant="outline" onClick={close}>Close schedule</Button></div>}
    </SheetContent></Sheet>
  </>;
}

function SchedulePanel({ schedule, occurrence, activity, recurrence, planning, reminders, onClose, onRefresh, onBusyChange, renderPayment }: { schedule: FinanceSchedule | null; occurrence: FinancePlan | null; activity: FinanceActivityController; recurrence: FinanceRecurrenceController; planning: FinancePlanningController; reminders: ReminderOptions; onClose: () => void; onRefresh: () => void; onBusyChange: (busy: boolean) => void; renderPayment: (plan: FinancePlan, onDone: () => void, onRefresh: () => void) => ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (!schedule || occurrence) return <FinancePlanningForm schedule={schedule} occurrence={occurrence} activity={activity} recurrence={recurrence} planning={planning} reminders={reminders} initialRecurring={true} onClose={onClose} onRefresh={onRefresh} onBusyChange={onBusyChange} />;
  if (editing) return <FinancePlanningForm schedule={schedule} occurrence={null} editSchedule={true} activity={activity} recurrence={recurrence} planning={planning} reminders={reminders} initialRecurring={true} onClose={() => { onRefresh(); setEditing(false); }} onRefresh={onRefresh} onBusyChange={onBusyChange} />;
  const nextDue = schedule.next_due_date;
  const daysUntil = nextDue ? Math.round((new Date(`${nextDue}T12:00:00`).getTime() - new Date(`${localCalendarDate()}T12:00:00`).getTime()) / 86400000) : null;
  const nextDueNote = nextDue && daysUntil !== null ? schedule.paused ? "Schedule paused" : daysUntil === 0 ? "Due today" : daysUntil > 0 ? `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}` : `${Math.abs(daysUntil)} day${daysUntil === -1 ? "" : "s"} overdue` : "This plan has ended";
  return <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
    <section aria-label="Plan summary" className="rounded-xl bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{schedule.text || schedule.category_name || "Recurring plan"}</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">{schedule.category_name || "Uncategorized"} · {schedule.account_name}</p>
        </div>
        <div className="shrink-0 text-right"><p className="text-base font-semibold tabular-nums">{money(schedule.amount_cents)}</p><p className="mt-0.5 text-xs text-muted-foreground">{cadence(schedule)}</p></div>
      </div>
      <div className="mt-3 rounded-lg bg-background p-3">
        <p className="text-xs text-muted-foreground">Next due</p>
        <p className="mt-0.5 text-sm font-semibold">{nextDue ? humanDate(nextDue) : "No further payment"}</p>
        {nextDue && <p className="text-xs text-muted-foreground">{nextDueNote}</p>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-background p-3"><dt className="text-xs text-muted-foreground">Ends</dt><dd className="mt-0.5 text-sm">{schedule.end_date ? humanDate(schedule.end_date) : "No end date"}{schedule.max_occurrences ? ` · ${schedule.max_occurrences} payments` : ""}{schedule.total_limit_cents ? ` · ${money(schedule.total_limit_cents)} limit` : ""}</dd></div>
        <div className="rounded-lg bg-background p-3"><dt className="text-xs text-muted-foreground">Handling</dt><dd className="mt-0.5 text-sm">{schedule.paused ? "Paused" : schedule.handling === "automatic" ? "Automatic" : "Manual"}</dd></div>
      </dl>
    </section>
    {schedule.automatic_error && <Alert><AlertDescription>{schedule.automatic_error}</AlertDescription></Alert>}
    {schedule.paused && <p className="text-xs text-muted-foreground">Resume starts at the next future due date. Existing pending review stays available.</p>}
    {schedule.obligation_id && <p className="text-sm">Linked {schedule.type === "expense" ? "debt" : "receivable"}: {reminders.obligations.find(row => row.id === schedule.obligation_id)?.name ?? "obligation"}. Pending occurrences require principal review.</p>}
    <div className="flex flex-wrap gap-2" aria-label="Schedule actions">
      <Button variant="outline" disabled={recurrence.busy || planning.busy} onClick={() => setEditing(true)}>Edit plan</Button>
      <Button variant="outline" disabled={recurrence.busy || planning.busy} onClick={() => void recurrence.save(schedule.id, schedule.paused ? "resume" : "pause", { version: schedule.version }).then(result => { if (result) onRefresh(); })}>{recurrence.busy ? "Saving…" : schedule.paused ? "Resume schedule" : "Pause schedule"}</Button>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline" className="text-destructive" disabled={recurrence.busy || planning.busy}>Delete plan</Button>} />
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this plan?</AlertDialogTitle>
            <AlertDialogDescription>Recorded history stays in Activity. Pending occurrences are cancelled and no balances change. The plan stops repeating.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recurrence.busy || planning.busy}>Keep plan</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={recurrence.busy || planning.busy} onClick={() => void recurrence.save(schedule.id, "delete", { version: schedule.version }).then(result => { if (result) onClose(); })}>{recurrence.busy ? "Deleting…" : "Delete plan"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    <FinanceSchedulePayments scheduleId={schedule.id} paused={schedule.paused} nextDueDate={schedule.next_due_date} pendingCount={schedule.pending_count} planning={planning} renderPayment={(plan, onDone, retry) => renderPayment(plan, () => { onDone(); onRefresh(); }, retry)} />
    {recurrence.saveError && <Alert><AlertDescription>{recurrence.saveError}<Button variant="outline" disabled={recurrence.busy} onClick={onRefresh}>Refresh schedule before editing</Button></AlertDescription></Alert>}
  </div>;
}
