"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinanceOptionStatus } from "./FinanceActivity";
import { useFinanceObligations, type FinanceObligationsController } from "@/features/finance/use-finance-obligations";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP } from "@/features/finance/presentation";

export function FinanceObligations({ activity }: { activity: FinanceActivityController }) {
  const obligations = useFinanceObligations(activity), router = useRouter();
  function inspectActivity() {
    if (!obligations.editing) return;
    activity.applyFilters({ q: "", account_id: "", category_id: "", date_from: "", date_to: "", type: "", hidden: "all", reverted: "all", obligation_id: obligations.editing.id });
    obligations.close(); router.replace("/app/finance?tab=activity", { scroll: false });
  }
  return <section aria-label="Debts and receivables" className="mt-8 border-t border-border pt-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Debts and receivables</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Money you owe and money owed to you. Outstanding principal is separate from cash and assets.</p></div><div className="flex flex-wrap gap-3"><Button variant="outline" className={control} onClick={() => obligations.openCreate("definition")}>Add obligation</Button><Button className={control} onClick={() => obligations.openCreate("movement")}>Record borrowing / lending</Button></div></div>
    {obligations.page && <dl className="my-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Outstanding debt (you owe)</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{formatPHP(obligations.page.debt_cents)}</dd></div><div><dt className="text-sm text-muted-foreground">Outstanding receivables (owed to you)</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{formatPHP(obligations.page.receivable_cents)}</dd></div></dl>}
    <p className="my-3 text-sm text-muted-foreground">Totals include archived obligations. Borrowing and lending never count as income or spending.</p>
    <div className="my-4 flex flex-wrap gap-5"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={obligations.overdue} onChange={e => obligations.setOverdue(e.target.checked)} />Overdue outstanding only</label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={obligations.archived} onChange={e => obligations.setArchived(e.target.checked)} />View archived obligations</label></div>
    {obligations.loadError ? <Alert><AlertDescription>{obligations.loadError}<Button variant="outline" className={control} onClick={() => void obligations.refresh()}>Retry obligations</Button></AlertDescription></Alert> : obligations.loading ? <p role="status" className="py-5 text-sm text-muted-foreground">Loading obligations…</p> : obligations.page?.obligations.length ? <ul className="divide-y divide-border">{obligations.page.obligations.map(row => <li key={row.id}><button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Inspect obligation ${row.name}`} onClick={() => void obligations.openEdit(row)}><span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{row.name}</span><span className="mt-1 block text-sm text-muted-foreground">{row.kind === "debt" ? "You owe" : "Owed to you"}{row.due_date ? ` · Due ${row.due_date}` : " · No due date"}{row.overdue ? " · Overdue" : ""}{row.archived ? " · Archived" : ""}</span></span><strong className="break-words text-sm tabular-nums">{formatPHP(row.outstanding_cents)}</strong></button></li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>No matching obligations</EmptyTitle><EmptyDescription>Add an existing debt or receivable without moving cash, or record actual borrowing or lending.</EmptyDescription></EmptyHeader></Empty>}
    {obligations.page && obligations.page.total > 25 && <nav aria-label="Obligation pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!obligations.offset || obligations.loading} onClick={() => obligations.setOffset(Math.max(0, obligations.offset - 25))}>Previous obligations</Button><span className="text-sm">{obligations.offset + 1}-{Math.min(obligations.offset + 25, obligations.page.total)} of {obligations.page.total}</span><Button variant="outline" className={control} disabled={obligations.offset + 25 >= obligations.page.total || obligations.loading} onClick={() => obligations.setOffset(obligations.offset + 25)}>Next obligations</Button></nav>}
    <Sheet open={obligations.panel !== null} onOpenChange={open => { if (!open && !obligations.busy) obligations.close(); }}><SheetContent className={financeSheet} showCloseButton={false}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>{obligations.panel === "movement" ? "Record borrowing or lending" : obligations.editing ? "Manage obligation" : "Add debt or receivable"}</SheetTitle><SheetDescription>{obligations.panel === "movement" ? "Confirm the money that actually moved. Cash and principal are recorded together, outside income and spending." : "Definitions alone never move cash. Do not enter existing principal again as new borrowing or lending."}</SheetDescription></SheetHeader>
      <ObligationPanel obligations={obligations} activity={activity} onInspectActivity={inspectActivity} />
    </SheetContent></Sheet>
  </section>;
}

function ObligationPanel({ obligations: o, activity, onInspectActivity }: { obligations: FinanceObligationsController; activity: FinanceActivityController; onInspectActivity: () => void }) {
  const movement = o.panel === "movement", editing = o.editing;
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `obligation-error-${key}` : undefined });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const another = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another";
    if (await o.save(another) && another) document.getElementById("obligation-name")?.focus();
  }
  return <div className="flex flex-1 flex-col gap-5 p-6">
    {o.inspecting && <p role="status">Loading obligation…</p>}
    {o.inspectError && <Alert><AlertDescription>{o.inspectError}<Button variant="outline" className={control} onClick={() => { if (editing) void o.openEdit(editing); }}>Retry obligation inspection</Button></AlertDescription></Alert>}
    {editing && <dl className="grid gap-3 text-sm"><div><dt className="text-muted-foreground">Outstanding principal</dt><dd className="text-xl font-semibold tabular-nums">{formatPHP(editing.outstanding_cents)}</dd></div><div><dt className="text-muted-foreground">Existing principal without cash movement</dt><dd>{formatPHP(editing.opening_principal_cents)}</dd></div><div><dt className="text-muted-foreground">Due date</dt><dd>{editing.due_date ?? "No due date"}{editing.overdue ? " · Overdue" : ""}</dd></div></dl>}
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        {!editing && <Field><FieldLabel htmlFor="obligation-kind">{movement ? "Actual movement" : "Obligation kind"}</FieldLabel><select id="obligation-kind" className={select} value={o.kind} disabled={disabled} onChange={e => o.setKind(e.target.value === "debt" ? "debt" : "receivable")}><option value="debt">{movement ? "Borrowing (adds cash and debt)" : "Debt (you owe)"}</option><option value="receivable">{movement ? "Lending (removes cash, owed to you)" : "Receivable (owed to you)"}</option></select></Field>}
        {(!movement || !editing) && <>
          <Field data-invalid={!!o.errors.name}><FieldLabel htmlFor="obligation-name">Obligation name</FieldLabel><Input id="obligation-name" maxLength={120} className={control} value={o.name} disabled={disabled} onChange={e => o.setName(e.target.value)} {...invalid("name")} /><FieldError id="obligation-error-name">{o.errors.name}</FieldError></Field>
          <Field data-invalid={!!o.errors.due_date}><FieldLabel htmlFor="obligation-due-date">Due date (optional)</FieldLabel><FinanceDateInput id="obligation-due-date" min="1000-01-01" max="9999-12-31" value={o.dueDate} disabled={disabled} onChange={o.setDueDate} {...invalid("due_date")} /><FieldError id="obligation-error-due_date">{o.errors.due_date}</FieldError></Field>
        </>}
        {!movement && !editing && <Field data-invalid={!!o.errors.principal}><FieldLabel htmlFor="obligation-principal">Already outstanding principal (PHP)</FieldLabel><Input id="obligation-principal" inputMode="decimal" className={control} value={o.principal} disabled={disabled} onChange={e => o.setPrincipal(e.target.value)} {...invalid("principal")} /><FieldDescription>Zero or a positive amount. Records an existing obligation only; your account balances will not change. Use Record borrowing / lending for money moving now.</FieldDescription><FieldError id="obligation-error-principal">{o.errors.principal}</FieldError></Field>}
        {movement && <>
          <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="obligation-amount">Actual principal amount (PHP)</FieldLabel><Input id="obligation-amount" inputMode="decimal" className={control} value={o.amount} disabled={disabled} onChange={e => o.setAmount(e.target.value)} {...invalid("amount")} /><FieldDescription>{o.kind === "debt" ? "Adds this amount to cash and debt." : "Removes this amount from cash and adds a receivable."} Positive amount with up to two decimals. Interest and fees are separate income/expense activity.</FieldDescription><FieldError id="obligation-error-amount">{o.errors.amount}</FieldError></Field>
          <Field data-invalid={!!o.errors.account_id}><FieldLabel htmlFor="obligation-account">Money account</FieldLabel><select id="obligation-account" className={select} value={o.accountId} disabled={disabled} onChange={e => o.setAccountId(e.target.value)} {...invalid("account_id")}><option value="">Choose a money account</option>{activity.accounts.filter(row => row.kind === "money" && !row.archived).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><FieldError id="obligation-error-account_id">{o.errors.account_id}</FieldError></Field>
          <Field data-invalid={!!o.errors.transaction_date}><FieldLabel htmlFor="obligation-date">Actual transaction date</FieldLabel><FinanceDateInput id="obligation-date" min="1000-01-01" max="9999-12-31" value={o.date} disabled={disabled} onChange={o.setDate} {...invalid("transaction_date")} /><FieldError id="obligation-error-transaction_date">{o.errors.transaction_date}</FieldError></Field>
          <Field><FieldLabel htmlFor="obligation-text">Transaction text (optional)</FieldLabel><Textarea id="obligation-text" maxLength={2000} value={o.text} disabled={disabled} onChange={e => o.setText(e.target.value)} /></Field>
          <FinanceOptionStatus activity={activity} />
        </>}
      </FieldGroup>
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale version.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      {o.notice && <p role="status" className="text-sm">{o.notice}</p>}
      <div className="flex flex-wrap justify-end gap-3">{!editing && <Button type="submit" name="another" variant="outline" className={control} disabled={disabled}>Save and add another</Button>}<Button type="submit" className={control} disabled={disabled}>{o.busy ? "Saving…" : movement ? "Confirm cash and principal" : editing ? "Save obligation changes" : "Create without cash movement"}</Button></div>
    </form>
    {editing && o.panel === "definition" && <div className="flex flex-wrap gap-3 border-t border-border pt-5"><Button variant="outline" className={control} disabled={disabled || editing.archived} onClick={o.startMovement}>{editing.kind === "debt" ? "Record more borrowing" : "Record more lending"}</Button><Button variant="outline" className={control} disabled={disabled} onClick={onInspectActivity}>Inspect linked activity</Button><Button variant="outline" className={control} disabled={disabled} onClick={() => void o.archive()}>{editing.archived ? "Restore obligation" : "Archive obligation"}</Button><p className="text-sm text-muted-foreground">Archiving retains cash and outstanding principal. Payments and write-offs arrive in the next slice.</p></div>}
    <Button variant="outline" className={`${control} mt-auto self-end`} disabled={o.busy} onClick={o.close}>Close obligation</Button>
  </div>;
}
