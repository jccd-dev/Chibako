"use client";

import { useEffect, useEffectEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IconArrowDownLeft, IconArrowUpRight } from "@tabler/icons-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FinanceObligationCreate, createSheetText } from "./FinanceObligationCreate";
import { FinanceObligationLog, FinanceObligationAddMore } from "./FinanceObligationLog";
import { FinanceObligationDetail, obligationStatus } from "./FinanceObligationDetail";
import { MoneyInput } from "./MoneyInput";
import { useFinanceObligations, type FinanceObligationsController } from "@/features/finance/use-finance-obligations";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeDrawerFooter, financeSheet, formatPHP } from "@/features/finance/presentation";

const eyebrow = (kind: "debt" | "receivable") => kind === "debt" ? "Debt" : "Money owed to you";
function sheetHeading(o: FinanceObligationsController): { eyebrow: string | null; title: string; description: string } {
  const e = o.editing;
  if (o.panel === "create") return { ...createSheetText[o.kind] };
  if (!e) return { eyebrow: null, title: "Obligation", description: "" };
  const debt = e.kind === "debt";
  if (o.panel === "payment") return { eyebrow: eyebrow(e.kind), title: debt ? "Log payment" : "Log collection",
    description: debt ? `Record a payment for ${e.name} from one of your accounts. Debt payments never count as spending.` : `Record collected money for ${e.name}. This applies the amount to your selected account right away.` };
  if (o.panel === "movement") return { eyebrow: eyebrow(e.kind), title: debt ? "Add more borrowing" : "Add more lending",
    description: "Confirm the money that actually moved. Cash and principal are recorded together, outside income and spending." };
  if (o.panel === "closure") return { eyebrow: eyebrow(e.kind), title: "Write off remaining principal",
    description: "Explicit closure for principal you will not collect or repay. A write-off is recorded here, never as a payment." };
  return { eyebrow: eyebrow(e.kind), title: e.name, description: "Log payments, add more, or review every money movement." };
}


export function FinanceObligations({
  activity,
  focusObligationId,
  onFocusHandled,
}: {
  activity: FinanceActivityController;
  focusObligationId?: string | null;
  onFocusHandled?: () => void;
}) {
  const obligations = useFinanceObligations(activity), router = useRouter();
  const openFocusedObligation = useEffectEvent(async (focusId: string, page: typeof obligations.page) => {
    if (!page) return;
    const obligation = page.obligations.find((row) => row.id === focusId);
    if (obligation) {
      void obligations.openEdit(obligation);
      onFocusHandled?.();
      return;
    }
    try {
      await obligations.openById(focusId);
    } finally {
      onFocusHandled?.();
    }
  });
  useEffect(() => {
    if (!focusObligationId || !obligations.page) return;
    void openFocusedObligation(focusObligationId, obligations.page);
  }, [focusObligationId, obligations.page, onFocusHandled]);
  function inspectActivity() {
    if (!obligations.editing) return;
    activity.applyFilters({ q: "", account_id: "", category_id: "", date_from: "", date_to: "", type: "", hidden: "all", reverted: "all", obligation_id: obligations.editing.id });
    obligations.close(); router.replace("/app/finance?tab=activity", { scroll: false });
  }
  return <section id="finance-obligations" aria-label="Debts and receivables">
    <Card size="sm">
      <CardHeader>
        <CardTitle>Debts and receivables</CardTitle>
        <CardDescription className="max-sm:col-start-1 max-sm:row-start-2">Money you owe and owed to you, separate from cash and assets.</CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-1 max-sm:col-start-1 max-sm:row-start-3">
          <Button size="sm" variant="outline" onClick={() => obligations.openCreate("debt")}>I owe someone</Button>
          <Button size="sm" onClick={() => obligations.openCreate("receivable")}>Someone owes me</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {obligations.page && <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">You owe</dt>
            <dd className="mt-1 break-words text-lg font-semibold tabular-nums">{formatPHP(obligations.page.debt_cents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Owed to you</dt>
            <dd className="mt-1 break-words text-lg font-semibold tabular-nums">{formatPHP(obligations.page.receivable_cents)}</dd>
          </div>
        </dl>}
        {obligations.page && obligations.archived && <p className="text-xs text-muted-foreground">Totals include archived obligations.</p>}
        {!obligations.panel && obligations.notice && <p role="status" className="text-xs">{obligations.notice}</p>}
        <div className="flex flex-wrap gap-5">
          <label className="flex min-h-7 items-center gap-2 text-xs"><Checkbox checked={obligations.overdue} onCheckedChange={checked => obligations.setOverdue(checked)} />Overdue outstanding only</label>
          <label className="flex min-h-7 items-center gap-2 text-xs"><Checkbox checked={obligations.archived} onCheckedChange={checked => obligations.setArchived(checked)} />View archived obligations</label>
        </div>
        {obligations.loadError ? <Alert><AlertDescription>{obligations.loadError}<Button variant="outline" onClick={() => void obligations.refresh()}>Retry obligations</Button></AlertDescription></Alert>
          : obligations.loading ? <p role="status" className="py-3 text-sm text-muted-foreground">Loading obligations…</p>
            : obligations.page?.obligations.length ? <ul className="flex flex-col divide-y divide-border/60">{obligations.page.obligations.map(row => <li key={row.id}>
              <button className="flex w-full items-start gap-3 rounded-sm px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Inspect obligation ${row.name}`} onClick={() => void obligations.openEdit(row)}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  {row.kind === "debt"
                    ? <IconArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    : <IconArrowDownLeft className="size-4 text-muted-foreground" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xs font-medium">{row.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{row.kind === "debt" ? "You owe" : "Owed to you"}{row.due_date ? ` · Due ${row.due_date}` : " · No due date"}{row.overdue && <span className="text-destructive"> · Overdue</span>}{row.status !== "open" ? ` · ${obligationStatus(row.status)}` : ""}{row.archived ? " · Archived" : ""}</span>
                </span>
                <strong className="shrink-0 break-words text-xs font-semibold tabular-nums">{formatPHP(row.outstanding_cents)}</strong>
              </button>
            </li>)}</ul>
              : <Empty className="px-0 py-2">
                <EmptyHeader>
                  <EmptyTitle>No matching obligations</EmptyTitle>
                  <EmptyDescription>Add money someone owes you or money you owe, with or without moving cash from an account.</EmptyDescription>
                </EmptyHeader>
              </Empty>}
        {obligations.page && obligations.page.total > 25 && <nav aria-label="Obligation pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!obligations.offset || obligations.loading} onClick={() => obligations.setOffset(Math.max(0, obligations.offset - 25))}>Previous obligations</Button><span className="text-sm">{obligations.offset + 1}-{Math.min(obligations.offset + 25, obligations.page.total)} of {obligations.page.total}</span><Button variant="outline" disabled={obligations.offset + 25 >= obligations.page.total || obligations.loading} onClick={() => obligations.setOffset(obligations.offset + 25)}>Next obligations</Button></nav>}
        <p className="text-xs text-muted-foreground">Borrowing, lending, principal payments and collections never count as income or spending.</p>
      </CardContent>
    </Card>
    <Sheet open={obligations.panel !== null} onOpenChange={open => { if (!open && !obligations.busy) obligations.close(); }}><SheetContent className={financeSheet} showCloseButton={false}>
      {(() => { const heading = sheetHeading(obligations); return <SheetHeader className="border-b border-border p-4">
        {heading.eyebrow && <p className="text-xs font-medium text-muted-foreground">{heading.eyebrow}</p>}
        <SheetTitle>{heading.title}</SheetTitle><SheetDescription>{heading.description}</SheetDescription>
      </SheetHeader>; })()}
      {obligations.panel === "create" ? <FinanceObligationCreate obligations={obligations} activity={activity} />
        : obligations.panel === "payment" ? <FinanceObligationLog o={obligations} activity={activity} />
          : obligations.panel === "movement" ? <FinanceObligationAddMore o={obligations} activity={activity} />
            : obligations.panel === "closure" && obligations.editing ? <ClosurePanel o={obligations} />
              : <FinanceObligationDetail o={obligations} onInspectActivity={inspectActivity} />}
    </SheetContent></Sheet>
  </section>;
}

function ClosurePanel({ o }: { o: FinanceObligationsController }) {
  const editing = o.editing;
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `closure-error-${key}` : undefined });
  function submit(event: FormEvent) {
    event.preventDefault();
    o.reviewClose();
  }
  return <div className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      <FieldGroup className="gap-6">
        <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="closure-amount">Amount to write off (PHP)</FieldLabel><MoneyInput id="closure-amount" inputMode="decimal" className="tabular-nums" value={o.amount} disabled={disabled} onValueChange={value => o.setAmount(value)} {...invalid("amount")} /><FieldDescription>Must equal the current remaining principal, <span className="tabular-nums">{formatPHP(editing?.outstanding_cents ?? 0)}</span>. A write-off is not a payment.</FieldDescription><FieldError id="closure-error-amount">{o.errors.amount}</FieldError></Field>
        <Field data-invalid={!!o.errors.reason}><FieldLabel htmlFor="closure-reason">Reason</FieldLabel><Textarea id="closure-reason" maxLength={2000} value={o.closeReason} disabled={disabled} onChange={e => o.setCloseReason(e.target.value)} {...invalid("reason")} /><FieldDescription>Required. For example: forgiven by lender, or uncollectible.</FieldDescription><FieldError id="closure-error-reason">{o.errors.reason}</FieldError></Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">Closing affects no cash balance and no income or spending reports. Amounts already paid and already written off stay distinct from each other. Use Record payment for money that actually moves.</p>
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale version.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      <div className={financeDrawerFooter}><Button type="button" variant="outline" disabled={disabled} onClick={() => o.setPanel("definition")}>Back to obligation</Button><Button type="submit" disabled={disabled}>{o.busy ? "Saving…" : "Review write-off"}</Button></div>
    </form>
    <ConfirmDialog open={o.closureReview !== null} onOpenChange={open => { if (!open) o.setClosureReview(null); }}
      title="Write off this remaining principal?"
      description={o.closureReview?.description ?? ""}
      confirmLabel="Write off remaining principal"
      onConfirm={() => { const review = o.closureReview; o.setClosureReview(null); if (review) void o.executeClose(review.input); }} />
  </div>;
}
