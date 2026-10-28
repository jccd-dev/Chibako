"use client";

import { useState, type FormEvent } from "react";
import { IconDotsVertical } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldError, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FinanceDateInput } from "./FinanceDateInputs";
import { CounterpartyChips } from "./FinanceObligationCreate";
import type { FinanceObligationsController } from "@/features/finance/use-finance-obligations";
import type { FinanceObligation, FinanceObligationHistoryEntry } from "@/features/finance/obligation-types";
import { financeDrawerFooter, formatHistoryDate, formatPHP } from "@/features/finance/presentation";

export const obligationStatus = (status: FinanceObligation["status"]) => ({ open: "Open", paid: "Paid in full", written_off: "Written off", settled: "Settled" })[status];
const counterpartyLabel = { person: "Person", entity: "Entity", organization: "Organization" } as const;

export function FinanceObligationDetail({ o, onInspectActivity }: { o: FinanceObligationsController; onInspectActivity: () => void }) {
  const editing = o.editing, [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const openActions = !!editing && editing.status === "open" && editing.outstanding_cents > 0;
  const debt = editing?.kind === "debt";
  const total = editing ? editing.paid_cents + editing.written_off_cents + editing.outstanding_cents : 0;
  const percent = editing && total > 0 ? Math.round(((editing.paid_cents + editing.written_off_cents) / total) * 100) : 0;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `obligation-error-${key}` : undefined });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await o.save();
  }
  return <div className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
    {o.inspecting && <p role="status">Loading obligation…</p>}
    {o.inspectError && <Alert><AlertDescription>{o.inspectError}<Button variant="outline" onClick={() => { if (editing) void o.openEdit(editing); }}>Retry obligation inspection</Button></AlertDescription></Alert>}
    {editing && <>
      <section aria-label="Progress" className="flex flex-col gap-3">
        <div><p className="text-xs text-muted-foreground">{debt ? "Remaining debt" : "Remaining collectible"}</p><p className="text-2xl font-semibold tabular-nums">{formatPHP(editing.outstanding_cents)}</p></div>
        <div role="progressbar" aria-label="Repayment progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
        <p className="text-xs text-muted-foreground tabular-nums">{debt ? "Paid" : "Collected"} {formatPHP(editing.paid_cents)} of {formatPHP(total)}{editing.written_off_cents > 0 ? ` · Written off ${formatPHP(editing.written_off_cents)}` : ""}</p>
      </section>
      <dl className="grid gap-3 text-sm">
        <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{obligationStatus(editing.status)}{editing.archived ? " · Archived" : ""}</dd></div>
        <div><dt className="text-muted-foreground">Due date</dt><dd>{editing.due_date ?? "No due date"}{editing.overdue ? " · Overdue" : ""}</dd></div>
        {editing.counterparty_type && <div><dt className="text-muted-foreground">Type</dt><dd>{counterpartyLabel[editing.counterparty_type]}</dd></div>}
        {editing.opening_principal_cents > 0 && <div><dt className="text-muted-foreground">Existing principal without cash movement</dt><dd className="tabular-nums">{formatPHP(editing.opening_principal_cents)}</dd></div>}
        {editing.notes && <div><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap break-words">{editing.notes}</dd></div>}
      </dl>
      {editing.status !== "open" && <p className="text-sm text-muted-foreground">This obligation is closed: {obligationStatus(editing.status)}. Paid and written-off amounts stay distinct; no further payments or write-offs are taken.</p>}
      {o.notice && <p role="status" className="text-sm">{o.notice}</p>}
      {o.saveError && <Alert><AlertDescription>{o.saveError}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={disabled || !openActions} onClick={o.startPayment}>{debt ? "Log payment" : "Log collection"}</Button>
        <Button variant="outline" disabled={disabled || editing.archived} onClick={o.startMovement}>Add more</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" disabled={disabled} />}><IconDotsVertical aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={!openActions} onClick={o.startClose}>Write off remaining</DropdownMenuItem>
            <DropdownMenuItem onClick={onInspectActivity}>View in Activity</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void o.archive()}>{editing.archived ? "Restore obligation" : "Archive obligation"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>Delete permanently…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-sm text-muted-foreground">Payments and collections reduce what remains without touching income or spending reports. Archiving keeps all amounts.</p>
      <ObligationHistory o={o} />
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Edit details</summary>
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-6">
          <FieldGroup className="gap-6">
            <Field><FieldLabel id="obligation-counterparty-label">Type (optional)</FieldLabel><CounterpartyChips value={o.counterparty} onChange={o.setCounterparty} disabled={disabled} /></Field>
            <Field data-invalid={!!o.errors.name}><FieldLabel htmlFor="obligation-name">Name</FieldLabel><Input id="obligation-name" maxLength={120} value={o.name} disabled={disabled} onChange={e => o.setName(e.target.value)} {...invalid("name")} /><FieldError id="obligation-error-name">{o.errors.name}</FieldError></Field>
            <Field data-invalid={!!o.errors.due_date}><FieldLabel htmlFor="obligation-due-date">Due date (optional)</FieldLabel><FinanceDateInput id="obligation-due-date" min="1000-01-01" max="9999-12-31" value={o.dueDate} disabled={disabled} onChange={o.setDueDate} {...invalid("due_date")} /><FieldError id="obligation-error-due_date">{o.errors.due_date}</FieldError></Field>
            <Field data-invalid={!!o.errors.notes}><FieldLabel htmlFor="obligation-notes">Notes (optional)</FieldLabel><Textarea id="obligation-notes" maxLength={2000} value={o.notes} disabled={disabled} onChange={e => o.setNotes(e.target.value)} {...invalid("notes")} /><FieldError id="obligation-error-notes">{o.errors.notes}</FieldError></Field>
          </FieldGroup>
          {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
          <div className="flex justify-end"><Button type="submit" disabled={disabled}>{o.busy ? "Saving…" : "Save changes"}</Button></div>
        </form>
      </details>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive
        title={`Delete ${editing.name} permanently?`}
        description="This removes the obligation and its history for good and cannot be undone. If it moved money, revert those entries in Activity first; Chibako refuses to delete while they are still active. No account balance changes."
        confirmLabel="Delete permanently"
        onConfirm={() => { setConfirmDelete(false); void o.remove(); }} />
    </>}
    <div className={financeDrawerFooter}><Button variant="outline" disabled={o.busy} onClick={o.close}>Close</Button></div>
  </div>;
}

function ObligationHistory({ o }: { o: FinanceObligationsController }) {
  const entryLabel = (entry: FinanceObligationHistoryEntry) => entry.kind === "write_off" ? "Write-off" : entry.kind === "borrowing" ? "Borrowed" : entry.kind === "lending" ? "Lent" : entry.cash_activity ? (entry.cash_activity.type === "income" ? "Receivable collection" : "Debt principal payment") : o.editing?.kind === "receivable" ? "Receivable collection" : "Debt principal payment";
  return <section aria-label="Money movement history" className="border-t border-border pt-5">
    <h3 className="font-semibold">Money movements</h3>
    <p className="mt-1 text-sm text-muted-foreground">Newest first. Borrowing, lending and principal payments stay outside income and spending reports.</p>
    {o.historyError ? <Alert className="mt-4"><AlertDescription>{o.historyError}<Button variant="outline" onClick={() => o.changeHistoryOffset(o.historyOffset)}>Retry history</Button></AlertDescription></Alert> : o.historyLoading && !o.history ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading history…</p> : o.history?.entries.length ? <>
      <ul className="divide-y divide-border">{o.history.entries.map(entry => <li key={entry.id}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2.5">
          <p className="min-w-0 truncate text-sm font-medium">{entryLabel(entry)}</p>
          <strong className="justify-self-end text-sm tabular-nums">{formatPHP(entry.amount_cents)}</strong>
          <p className="min-w-0 truncate text-xs text-muted-foreground">{entry.transaction_date ? formatHistoryDate(entry.transaction_date) : "No date"}</p>
          <span aria-hidden="true" />
        </div>
        {(entry.hidden || entry.reverted) && <p className="pb-3 text-xs">{entry.hidden ? "Hidden" : ""}{entry.hidden && entry.reverted ? " · " : ""}{entry.reverted ? "Reverted" : ""}</p>}
        {entry.cash_activity && <p className="pb-4 text-sm text-muted-foreground">Cash activity: {({ expense: "Expense", income: "Income", borrowing: "Cash in", lending: "Cash out" })[entry.cash_activity.type]} · {entry.cash_activity.account_name} · {formatHistoryDate(entry.cash_activity.transaction_date)} · <span className="tabular-nums">{formatPHP(entry.cash_activity.amount_cents)}</span></p>}
        {entry.text && entry.kind !== "write_off" && <p className="-mt-2 pb-4 break-words text-sm text-muted-foreground">{entry.text}</p>}
        {entry.reason && entry.kind === "write_off" && <p className="-mt-2 pb-4 break-words text-sm text-muted-foreground">{entry.reason}</p>}
      </li>)}</ul>
      {o.history.total > 25 && <nav aria-label="Payment history pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" disabled={o.historyOffset === 0 || o.historyLoading} onClick={() => o.changeHistoryOffset(Math.max(0, o.historyOffset - 25))}>Previous entries</Button><span className="text-sm">{o.historyOffset + 1}-{Math.min(o.historyOffset + 25, o.history.total)} of {o.history.total}</span><Button variant="outline" disabled={o.historyOffset + 25 >= o.history.total || o.historyLoading} onClick={() => o.changeHistoryOffset(o.historyOffset + 25)}>Next entries</Button></nav>}
    </> : <p className="py-4 text-sm text-muted-foreground">No money movements yet. Record a payment or collection from this panel.</p>}
  </section>;
}
