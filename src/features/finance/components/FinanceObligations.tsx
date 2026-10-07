"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinanceOptionStatus } from "./FinanceActivity";
import { useFinanceObligations, type FinanceObligationsController } from "@/features/finance/use-finance-obligations";
import type { FinanceObligation, FinanceObligationHistoryEntry } from "@/features/finance/obligation-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP } from "@/features/finance/presentation";

const obligationStatus = (status: FinanceObligation["status"]) => ({ open: "Open", paid: "Paid in full", written_off: "Written off", settled: "Settled" })[status];

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
    <p className="my-3 text-sm text-muted-foreground">Totals include archived obligations. Borrowing, lending, principal payments and collections never count as income or spending.</p>
    <div className="my-4 flex flex-wrap gap-5"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={obligations.overdue} onChange={e => obligations.setOverdue(e.target.checked)} />Overdue outstanding only</label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={obligations.archived} onChange={e => obligations.setArchived(e.target.checked)} />View archived obligations</label></div>
    {obligations.loadError ? <Alert><AlertDescription>{obligations.loadError}<Button variant="outline" className={control} onClick={() => void obligations.refresh()}>Retry obligations</Button></AlertDescription></Alert> : obligations.loading ? <p role="status" className="py-5 text-sm text-muted-foreground">Loading obligations…</p> : obligations.page?.obligations.length ? <ul className="divide-y divide-border">{obligations.page.obligations.map(row => <li key={row.id}><button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Inspect obligation ${row.name}`} onClick={() => void obligations.openEdit(row)}><span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{row.name}</span><span className="mt-1 block text-sm text-muted-foreground">{row.kind === "debt" ? "You owe" : "Owed to you"}{row.due_date ? ` · Due ${row.due_date}` : " · No due date"}{row.overdue ? " · Overdue" : ""}{row.status !== "open" ? ` · ${obligationStatus(row.status)}` : ""}{row.archived ? " · Archived" : ""}</span></span><strong className="break-words text-sm tabular-nums">{formatPHP(row.outstanding_cents)}</strong></button></li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>No matching obligations</EmptyTitle><EmptyDescription>Add an existing debt or receivable without moving cash, or record actual borrowing or lending.</EmptyDescription></EmptyHeader></Empty>}
    {obligations.page && obligations.page.total > 25 && <nav aria-label="Obligation pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!obligations.offset || obligations.loading} onClick={() => obligations.setOffset(Math.max(0, obligations.offset - 25))}>Previous obligations</Button><span className="text-sm">{obligations.offset + 1}-{Math.min(obligations.offset + 25, obligations.page.total)} of {obligations.page.total}</span><Button variant="outline" className={control} disabled={obligations.offset + 25 >= obligations.page.total || obligations.loading} onClick={() => obligations.setOffset(obligations.offset + 25)}>Next obligations</Button></nav>}
    <Sheet open={obligations.panel !== null} onOpenChange={open => { if (!open && !obligations.busy) obligations.close(); }}><SheetContent className={financeSheet} showCloseButton={false}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>{obligations.panel === "payment" ? (obligations.editing?.kind === "debt" ? "Record principal payment" : "Record collection") : obligations.panel === "closure" ? "Write off remaining principal" : obligations.panel === "movement" ? "Record borrowing or lending" : obligations.editing ? "Manage obligation" : "Add debt or receivable"}</SheetTitle><SheetDescription>{obligations.panel === "payment" ? "Dated partial payments against outstanding principal. Debt payments and receivable collections never count as spending or income. Interest and fees are separate ordinary transactions." : obligations.panel === "closure" ? "Explicit closure for principal you will not collect or repay. A write-off is recorded here, never as a payment." : obligations.panel === "movement" ? "Confirm the money that actually moved. Cash and principal are recorded together, outside income and spending." : "Definitions alone never move cash. Do not enter existing principal again as new borrowing or lending."}</SheetDescription></SheetHeader>
      {obligations.panel === "payment" && obligations.editing ? <PaymentPanel o={obligations} activity={activity} /> : obligations.panel === "closure" && obligations.editing ? <ClosurePanel o={obligations} /> : <ObligationPanel obligations={obligations} activity={activity} onInspectActivity={inspectActivity} />}
    </SheetContent></Sheet>
  </section>;
}

function ObligationPanel({ obligations: o, activity, onInspectActivity }: { obligations: FinanceObligationsController; activity: FinanceActivityController; onInspectActivity: () => void }) {
  const movement = o.panel === "movement", editing = o.editing;
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const openActions = !!editing && editing.status === "open" && editing.outstanding_cents > 0;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `obligation-error-${key}` : undefined });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const another = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another";
    if (await o.save(another) && another) document.getElementById("obligation-name")?.focus();
  }
  return <div className="flex flex-1 flex-col gap-5 p-6">
    {o.inspecting && <p role="status">Loading obligation…</p>}
    {o.inspectError && <Alert><AlertDescription>{o.inspectError}<Button variant="outline" className={control} onClick={() => { if (editing) void o.openEdit(editing); }}>Retry obligation inspection</Button></AlertDescription></Alert>}
    {editing && <dl className="grid gap-3 text-sm">
      <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{obligationStatus(editing.status)}</dd></div>
      <div><dt className="text-muted-foreground">Remaining principal</dt><dd className="text-xl font-semibold tabular-nums">{formatPHP(editing.outstanding_cents)}</dd></div>
      <div><dt className="text-muted-foreground">Paid so far</dt><dd className="tabular-nums">{formatPHP(editing.paid_cents)}</dd></div>
      <div><dt className="text-muted-foreground">Written off</dt><dd className="tabular-nums">{formatPHP(editing.written_off_cents)}</dd></div>
      <div><dt className="text-muted-foreground">Existing principal without cash movement</dt><dd>{formatPHP(editing.opening_principal_cents)}</dd></div>
      <div><dt className="text-muted-foreground">Due date</dt><dd>{editing.due_date ?? "No due date"}{editing.overdue ? " · Overdue" : ""}</dd></div>
    </dl>}
    {editing && editing.status !== "open" && <p className="text-sm text-muted-foreground">This obligation is closed: {obligationStatus(editing.status)}. Paid and written-off amounts stay distinct; no further payments or write-offs are taken.</p>}
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
    {editing && o.panel === "definition" && <>
      <div className="flex flex-wrap gap-3 border-t border-border pt-5"><Button variant="outline" className={control} disabled={disabled || !openActions} onClick={o.startPayment}>{editing.kind === "debt" ? "Record payment" : "Record collection"}</Button><Button variant="outline" className={control} disabled={disabled || !openActions} onClick={o.startClose}>Write off remaining</Button><Button variant="outline" className={control} disabled={disabled || editing.archived} onClick={o.startMovement}>{editing.kind === "debt" ? "Record more borrowing" : "Record more lending"}</Button><Button variant="outline" className={control} disabled={disabled} onClick={onInspectActivity}>Inspect linked activity</Button><Button variant="outline" className={control} disabled={disabled} onClick={() => void o.archive()}>{editing.archived ? "Restore obligation" : "Archive obligation"}</Button></div>
      <p className="text-sm text-muted-foreground">Payments and collections reduce outstanding principal without touching income or spending reports. Archiving retains cash, paid and written-off amounts.</p>
      <ObligationHistory o={o} />
    </>}
    <Button variant="outline" className={`${control} mt-auto self-end`} disabled={o.busy} onClick={o.close}>Close obligation</Button>
  </div>;
}

function PaymentPanel({ o, activity }: { o: FinanceObligationsController; activity: FinanceActivityController }) {
  const editing = o.editing;
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const selected = o.pSelected;
  const linkedLabel = selected ? (selected.type === "expense" ? "Debt principal payment" : "Receivable collection") : "";
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `payment-error-${key}` : undefined });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await o.pay();
  }
  return <div className="flex flex-1 flex-col gap-5 p-6">
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="payment-amount">Payment amount (PHP)</FieldLabel><Input id="payment-amount" inputMode="decimal" className={`${control} tabular-nums`} value={o.amount} disabled={disabled || !!selected} onChange={e => o.setAmount(e.target.value)} {...invalid("amount")} /><FieldDescription>{selected ? "Taken from the linked activity." : editing?.kind === "debt" ? "Reduces cash and outstanding debt. Partial payments are supported; principal is excluded from spending reports." : "Increases cash and reduces the receivable. Partial collections are supported; principal is excluded from income reports."}</FieldDescription><FieldError id="payment-error-amount">{o.errors.amount}</FieldError></Field>
        <Field data-invalid={!!o.errors.account_id}><FieldLabel htmlFor="payment-account">Money account</FieldLabel><select id="payment-account" className={select} value={o.accountId} disabled={disabled || !!selected} onChange={e => o.setAccountId(e.target.value)} {...invalid("account_id")}><option value="">Choose a money account</option>{activity.accounts.filter(row => row.kind === "money" && !row.archived).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><FieldDescription>{selected ? "Taken from the linked activity." : "The account the cash actually moved in."}</FieldDescription><FieldError id="payment-error-account_id">{o.errors.account_id}</FieldError></Field>
        <Field data-invalid={!!o.errors.transaction_date}><FieldLabel htmlFor="payment-date">Transaction date</FieldLabel><FinanceDateInput id="payment-date" min="1000-01-01" max="9999-12-31" value={o.date} disabled={disabled || !!selected} onChange={o.setDate} {...invalid("transaction_date")} /><FieldDescription>{selected ? "Taken from the linked activity." : "The calendar day the cash moved."}</FieldDescription><FieldError id="payment-error-transaction_date">{o.errors.transaction_date}</FieldError></Field>
        <Field data-invalid={!!o.errors.cash_activity_id || !!o.errors.cash_activity_version}><FieldLabel htmlFor="payment-source">Cash source</FieldLabel><select id="payment-source" className={select} value={o.pSource} disabled={disabled} onChange={e => o.choosePaymentSource(e.target.value === "existing" ? "existing" : "new")} {...invalid("cash_activity_id")}><option value="new">New cash transaction — record cash with this payment</option><option value="existing">Link existing activity — no second cash effect</option></select><FieldDescription>{o.pSource === "new" ? "Records a matching cash transaction with the payment. Its category is excluded from income and spending reports." : "Choose an expense (for a debt payment) or income (for a collection) from bounded history. Its account, date and amount are used exactly as recorded."}</FieldDescription><FieldError id="payment-error-cash_activity_id">{o.errors.cash_activity_id}</FieldError><FieldError id="payment-error-cash_activity_version">{o.errors.cash_activity_version}</FieldError></Field>
        {o.pSource === "existing" && (selected ? <div className="flex flex-col gap-3">
          <dl className="grid gap-3 rounded-md border border-border p-4 text-sm">
            <div><dt className="text-muted-foreground">Linked activity</dt><dd className="font-medium">{linkedLabel} · <span className="tabular-nums">{formatPHP(selected.amount_cents)}</span></dd></div>
            <div><dt className="text-muted-foreground">Account</dt><dd>{selected.account_name}</dd></div>
            <div><dt className="text-muted-foreground">Transaction date</dt><dd>{selected.transaction_date}</dd></div>
            <div><dt className="text-muted-foreground">Activity version</dt><dd className="tabular-nums">{selected.version}</dd></div>
            {selected.text && <div><dt className="text-muted-foreground">Activity text</dt><dd className="whitespace-pre-wrap break-words">{selected.text}</dd></div>}
          </dl>
          <p className="text-sm text-muted-foreground">Linking keeps the recorded cash effect and its own text; no duplicate cash movement is posted. Corrections later happen through Activity and update outstanding principal together.</p>
          <Button type="button" variant="outline" className={`${control} self-start`} disabled={disabled} onClick={o.clearCandidate}>Choose a different activity</Button>
        </div> : <PaymentCandidates o={o} />)}
        <Field><FieldLabel htmlFor="payment-text">Payment text (optional)</FieldLabel><Textarea id="payment-text" maxLength={2000} value={o.text} disabled={disabled || !!selected} onChange={e => o.setText(e.target.value)} /><FieldDescription>{selected ? "A linked activity keeps its own text." : "Used on the new cash activity only."}</FieldDescription></Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">Interest and fees are separate ordinary income or expenses: record them with Add transaction in Activity. No interest is calculated automatically.</p>
      <FinanceOptionStatus activity={activity} />
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale version.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      <div className="flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" className={control} disabled={disabled} onClick={() => o.setPanel("definition")}>Back to obligation</Button><Button type="submit" className={control} disabled={disabled}>{o.busy ? "Saving…" : o.pSource === "existing" ? "Review payment" : "Record payment"}</Button></div>
    </form>
    <ConfirmDialog open={o.paymentReview !== null} onOpenChange={open => { if (!open) o.setPaymentReview(null); }}
      title="Link this existing activity?"
      description={o.paymentReview?.description ?? ""}
      confirmLabel="Link without new cash effect"
      onConfirm={() => { const review = o.paymentReview; o.setPaymentReview(null); if (review) void o.payConfirmed(review.input); }} />
  </div>;
}

function PaymentCandidates({ o }: { o: FinanceObligationsController }) {
  return <div className="flex flex-col gap-3">
    {o.pError ? <Alert><AlertDescription>{o.pError}<Button variant="outline" className={control} onClick={() => void o.loadCandidates(o.pOffset)}>Retry matching history</Button></AlertDescription></Alert> : o.pLoading ? <p role="status" className="text-sm text-muted-foreground">Loading matching history…</p> : o.pCandidates.length ? <>
      <p className="text-sm text-muted-foreground">{o.pTotal} eligible record{o.pTotal === 1 ? "" : "s"}. Selecting fills account, date and amount exactly as recorded.</p>
      <ul className="divide-y divide-border border-y border-border">{o.pCandidates.map(row => <li key={row.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-muted active:bg-muted" onClick={() => o.selectCandidate(row)} aria-label={`Select ${row.type === "expense" ? "expense" : "income"} ${formatPHP(row.amount_cents)} on ${row.transaction_date}`}>
        <span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{row.category_name ?? (row.type === "expense" ? "Expense" : "Income")}</span><span className="mt-1 block break-words text-sm text-muted-foreground">{row.transaction_date} · {row.account_name}</span></span>
        <strong className="break-words text-sm tabular-nums">{formatPHP(row.amount_cents)}</strong>
      </button></li>)}</ul>
      {o.pTotal > 25 && <nav aria-label="Matching history pages" className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" className={control} disabled={o.pOffset === 0 || o.pLoading} onClick={() => void o.loadCandidates(Math.max(0, o.pOffset - 25))}>Previous records</Button><span className="text-sm">{o.pOffset + 1}-{Math.min(o.pOffset + 25, o.pTotal)} of {o.pTotal}</span><Button type="button" variant="outline" className={control} disabled={o.pOffset + 25 >= o.pTotal || o.pLoading} onClick={() => void o.loadCandidates(o.pOffset + 25)}>Next records</Button></nav>}
    </> : <p className="text-sm text-muted-foreground">No eligible {o.editing?.kind === "debt" ? "expense" : "income"} history to link. Record the payment as a new cash transaction, or add the transaction with Add transaction and load this list again.</p>}
  </div>;
}

function ClosurePanel({ o }: { o: FinanceObligationsController }) {
  const editing = o.editing;
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `closure-error-${key}` : undefined });
  function submit(event: FormEvent) {
    event.preventDefault();
    o.reviewClose();
  }
  return <div className="flex flex-1 flex-col gap-5 p-6">
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="closure-amount">Amount to write off (PHP)</FieldLabel><Input id="closure-amount" inputMode="decimal" className={`${control} tabular-nums`} value={o.amount} disabled={disabled} onChange={e => o.setAmount(e.target.value)} {...invalid("amount")} /><FieldDescription>Must equal the current remaining principal, <span className="tabular-nums">{formatPHP(editing?.outstanding_cents ?? 0)}</span>. A write-off is not a payment.</FieldDescription><FieldError id="closure-error-amount">{o.errors.amount}</FieldError></Field>
        <Field data-invalid={!!o.errors.reason}><FieldLabel htmlFor="closure-reason">Reason</FieldLabel><Textarea id="closure-reason" maxLength={2000} value={o.closeReason} disabled={disabled} onChange={e => o.setCloseReason(e.target.value)} {...invalid("reason")} /><FieldDescription>Required. For example: forgiven by lender, or uncollectible.</FieldDescription><FieldError id="closure-error-reason">{o.errors.reason}</FieldError></Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">Closing affects no cash balance and no income or spending reports. Amounts already paid and already written off stay distinct from each other. Use Record payment for money that actually moves.</p>
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale version.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      <div className="flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" className={control} disabled={disabled} onClick={() => o.setPanel("definition")}>Back to obligation</Button><Button type="submit" className={control} disabled={disabled}>{o.busy ? "Saving…" : "Review write-off"}</Button></div>
    </form>
    <ConfirmDialog open={o.closureReview !== null} onOpenChange={open => { if (!open) o.setClosureReview(null); }}
      title="Write off this remaining principal?"
      description={o.closureReview?.description ?? ""}
      confirmLabel="Write off remaining principal"
      onConfirm={() => { const review = o.closureReview; o.setClosureReview(null); if (review) void o.executeClose(review.input); }} />
  </div>;
}

function ObligationHistory({ o }: { o: FinanceObligationsController }) {
  const entryLabel = (entry: FinanceObligationHistoryEntry) => entry.kind === "write_off" ? "Write-off" : entry.cash_activity ? (entry.cash_activity.type === "income" ? "Receivable collection" : "Debt principal payment") : o.editing?.kind === "receivable" ? "Receivable collection" : "Debt principal payment";
  return <section aria-label="Payment and write-off history" className="border-t border-border pt-5">
    <h3 className="font-semibold">Payments and write-offs</h3>
    <p className="mt-1 text-sm text-muted-foreground">Newest first. Principal payments stay outside income and spending reports.</p>
    {o.historyError ? <Alert className="mt-4"><AlertDescription>{o.historyError}<Button variant="outline" className={control} onClick={() => o.changeHistoryOffset(o.historyOffset)}>Retry history</Button></AlertDescription></Alert> : o.historyLoading && !o.history ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading history…</p> : o.history?.entries.length ? <>
      <ul className="divide-y divide-border">{o.history.entries.map(entry => <li key={entry.id}>
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0 flex-1 basis-40"><p className="break-words text-sm font-medium">{entryLabel(entry)}</p><p className="mt-1 break-words text-sm text-muted-foreground">{entry.transaction_date ?? "No date"}{entry.hidden ? " · Hidden" : ""}{entry.reverted ? " · Reverted" : ""}</p></div>
          <strong className="break-words text-sm tabular-nums">{formatPHP(entry.amount_cents)}</strong>
        </div>
        {entry.cash_activity && <p className="pb-4 text-sm text-muted-foreground">Cash activity: {entry.cash_activity.type === "expense" ? "Expense" : "Income"} · {entry.cash_activity.account_name} · {entry.cash_activity.transaction_date} · <span className="tabular-nums">{formatPHP(entry.cash_activity.amount_cents)}</span></p>}
        {entry.text && entry.kind === "payment" && <p className="-mt-2 pb-4 break-words text-sm text-muted-foreground">{entry.text}</p>}
        {entry.reason && entry.kind === "write_off" && <p className="-mt-2 pb-4 break-words text-sm text-muted-foreground">{entry.reason}</p>}
      </li>)}</ul>
      {o.history.total > 25 && <nav aria-label="Payment history pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={o.historyOffset === 0 || o.historyLoading} onClick={() => o.changeHistoryOffset(Math.max(0, o.historyOffset - 25))}>Previous entries</Button><span className="text-sm">{o.historyOffset + 1}-{Math.min(o.historyOffset + 25, o.history.total)} of {o.history.total}</span><Button variant="outline" className={control} disabled={o.historyOffset + 25 >= o.history.total || o.historyLoading} onClick={() => o.changeHistoryOffset(o.historyOffset + 25)}>Next entries</Button></nav>}
    </> : <p className="py-4 text-sm text-muted-foreground">No payments or write-offs yet. Record a payment or collection from this panel.</p>}
  </section>;
}
