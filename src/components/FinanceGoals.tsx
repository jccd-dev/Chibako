"use client";

import { useState, type FormEvent } from "react";
import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { FinanceGoal } from "@/features/finance/goal-types";
import { useFinanceGoals, type FinanceGoalsController } from "@/features/finance/use-finance-goals";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP, localCalendarDate } from "@/features/finance/presentation";

export function FinanceGoals() {
  const goals = useFinanceGoals();
  return <Card size="sm" className="mt-6">
    <CardHeader>
      <CardTitle>Savings goals</CardTitle>
      <CardDescription>Reserve money already held in your accounts. Progress stays separate from cash totals.</CardDescription>
      <CardAction><Button variant="ghost" size="icon" className={control} aria-label="Add savings goal" onClick={goals.openCreate}><IconPlus aria-hidden="true" /></Button></CardAction>
    </CardHeader>
    <CardContent>
      <label className="mb-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={goals.archived} onChange={event => goals.changeArchived(event.target.checked)} />View archived goals</label>
      {goals.loadError ? <Alert><AlertDescription>{goals.loadError}<Button variant="outline" className={control} onClick={() => void goals.refresh()}>Retry goals</Button></AlertDescription></Alert>
        : goals.loading ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading goals…</p>
          : !goals.page?.goals.length ? <Empty className="px-0 py-4"><EmptyHeader><EmptyTitle>No {goals.archived ? "archived " : ""}goals</EmptyTitle><EmptyDescription>Create a target, then reserve existing account money for it.</EmptyDescription></EmptyHeader>{!goals.archived && <Button variant="outline" className={control} onClick={goals.openCreate}>Add goal</Button>}</Empty>
            : <ul className="divide-y divide-border">{goals.page.goals.map(goal => <GoalRow key={goal.id} goal={goal} onOpen={() => void goals.openEdit(goal)} />)}</ul>}
      {goals.page && goals.page.total > 25 && <nav aria-label="Goal pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!goals.offset || goals.loading} onClick={() => goals.setOffset(Math.max(0, goals.offset - 25))}>Previous goals</Button><span>{goals.offset + 1}–{Math.min(goals.offset + 25, goals.page.total)} of {goals.page.total}</span><Button variant="outline" className={control} disabled={goals.offset + 25 >= goals.page.total || goals.loading} onClick={() => goals.setOffset(goals.offset + 25)}>Next goals</Button></nav>}
    </CardContent>
    <Sheet open={goals.panel !== null} onOpenChange={open => { if (!open && !goals.busy) goals.closePanel(); }}>
      <SheetContent className={financeSheet} showCloseButton={false}>
        <SheetHeader className="border-b border-border p-6"><SheetTitle>{goals.panel === "create" ? "Add goal" : goals.editing?.archived ? "Archived goal" : "Edit goal"}</SheetTitle><SheetDescription>Allocations reserve existing money. Transfers and spending are separate activity.</SheetDescription></SheetHeader>
        <GoalPanel key={goals.panel ?? "closed"} goals={goals} />
      </SheetContent>
    </Sheet>
  </Card>;
}

function GoalRow({ goal, onOpen }: { goal: FinanceGoal; onOpen: () => void }) {
  const percent = Math.min(100, Math.round(goal.saved_cents / goal.target_cents * 100));
  const overdue = !goal.achieved && !goal.archived && !!goal.due_date && goal.due_date < localCalendarDate();
  return <li><button className="w-full rounded-md px-1 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${goal.archived ? "View" : "Edit"} goal ${goal.name}`} onClick={onOpen}>
    <span className="flex flex-wrap items-baseline justify-between gap-3"><span className="min-w-0 break-words font-medium">{goal.name}</span><span className="tabular-nums"><strong>{formatPHP(goal.saved_cents)}</strong><span className="text-muted-foreground"> of {formatPHP(goal.target_cents)}</span></span></span>
    <span className="mt-1 block text-xs text-muted-foreground">{goal.archived ? "Archived · reservations released" : goal.achieved ? "Achieved" : "Saving"}{goal.due_date && ` · Due ${goal.due_date}`}{overdue && " · overdue"}</span>
    {!goal.archived && goal.allocations.filter(row => row.shortfall_cents > 0).map(row => <span key={row.account_id} className="mt-1 block text-sm font-medium text-foreground">{row.account_name}: account allocation shortfall {formatPHP(row.shortfall_cents)}</span>)}
    <span role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 block h-1.5 overflow-hidden rounded-sm bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>
  </button></li>;
}

function GoalPanel({ goals }: { goals: FinanceGoalsController }) {
  const goal = goals.editing, readOnly = !!goal?.archived, disabled = goals.busy || goals.inspecting;
  const selected = goals.accounts.find(row => row.account_id === goals.accountId);
  const existing = goal?.allocations.find(row => row.account_id === goals.accountId)?.amount_cents ?? 0;
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void goals.save(); }
  return <div className="flex flex-1 flex-col gap-6 p-6">
    {goals.inspecting && <p role="status">Loading goal…</p>}
    {goals.saveError && <Alert><AlertDescription>{goals.saveError} Retry safely, or close and reopen the goal to refresh its version.</AlertDescription></Alert>}
    {goals.notice && <p role="status">{goals.notice}</p>}
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field><FieldLabel htmlFor="goal-name">Name</FieldLabel><Input id="goal-name" maxLength={120} className={control} value={goals.name} disabled={disabled || readOnly} onChange={event => goals.setName(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="goal-target">Target (PHP)</FieldLabel><Input id="goal-target" inputMode="decimal" className={control} value={goals.target} disabled={disabled || readOnly} onChange={event => goals.setTarget(event.target.value)} /><FieldDescription>A positive amount with up to two decimal places.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="goal-due-date">Due date (optional)</FieldLabel><Input id="goal-due-date" type="date" min="1000-01-01" max="9999-12-31" className={control} value={goals.dueDate} disabled={disabled || readOnly} onChange={event => goals.setDueDate(event.target.value)} /></Field>
      </FieldGroup>
      {!readOnly && <div className="mt-4 flex justify-end"><Button type="submit" className={control} disabled={disabled}>{goals.busy ? "Saving…" : goal ? "Save goal changes" : "Add goal"}</Button></div>}
    </form>
    {goal && <section aria-label="Goal allocations" className="space-y-4 border-t border-border pt-5">
      <p className="font-medium">{formatPHP(goal.saved_cents)} of {formatPHP(goal.target_cents)}{goal.achieved && " · Achieved"}</p>
      <p className="text-sm text-muted-foreground">{readOnly ? "Historical allocations below have been released. They no longer reserve account money." : "Set each account's reserved total. Use zero to release it. These amounts already belong to your cash totals."}</p>
      <ul className="space-y-3">{goal.allocations.map(row => <li key={row.account_id} className="text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="break-words">{row.account_name}</span><strong className="tabular-nums">{formatPHP(row.amount_cents)}</strong></div>{!readOnly && row.shortfall_cents > 0 && <p className="font-medium text-foreground">Account allocation shortfall: {formatPHP(row.shortfall_cents)} across all goals.</p>}</li>)}</ul>
      {!readOnly && <>
        <Field><FieldLabel htmlFor="goal-account">Money account</FieldLabel><select id="goal-account" className={select} disabled={disabled} value={goals.accountId} onChange={event => goals.selectAccount(event.target.value)}><option value="">Choose an account</option>{goals.accounts.filter(row => !row.archived || goal.allocations.some(allocation => allocation.account_id === row.account_id)).map(row => <option key={row.account_id} value={row.account_id}>{row.account_name}{row.archived ? " (archived; releases only)" : ""}</option>)}</select></Field>
        {selected && <p className="text-sm">Cash: {formatPHP(selected.balance_cents)} · Reserved across goals: {formatPHP(selected.reserved_cents)} · Available: {formatPHP(selected.available_cents)}{selected.shortfall_cents > 0 && <span className="block font-medium text-foreground">Account allocation shortfall: {formatPHP(selected.shortfall_cents)}</span>}</p>}
        <Field><FieldLabel htmlFor="goal-allocation">Reserved total (PHP)</FieldLabel><Input id="goal-allocation" inputMode="decimal" className={control} disabled={disabled || !selected} value={goals.amount} onChange={event => goals.setAmount(event.target.value)} /><FieldDescription>This goal currently reserves {formatPHP(existing)} on the selected account. Cash never moves.</FieldDescription></Field>
        <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className={control} disabled={disabled || !existing} onClick={() => void goals.allocate("0")}>Release allocation</Button><Button className={control} disabled={disabled || !selected} onClick={() => void goals.allocate()}>Set reservation</Button></div>
      </>}
    </section>}
    <div className="mt-auto flex flex-wrap justify-end gap-3 border-t border-border pt-5">{goal && !readOnly && <ArchiveButton goals={goals} />}<Button variant="outline" className={control} disabled={goals.busy} onClick={goals.closePanel}>{readOnly ? "Close" : "Cancel"}</Button></div>
  </div>;
}

function ArchiveButton({ goals }: { goals: FinanceGoalsController }) {
  const [confirming, setConfirming] = useState(false);
  return <div className="space-y-2">{confirming && <p className="text-sm">Archive this goal and release every reservation? History is kept.</p>}<Button variant="outline" className={control} disabled={goals.busy || goals.inspecting} onClick={() => { if (confirming) void goals.archive(); else setConfirming(true); }}>{confirming ? "Confirm archive" : "Archive goal"}</Button></div>;
}
