"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinanceOptionStatus } from "./FinanceActivity";
import { FinanceAccountChoice } from "./FinanceAccountChoice";
import { MoneyInput } from "./MoneyInput";
import type { FinanceObligationsController } from "@/features/finance/use-finance-obligations";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { obligationQuickAmounts } from "@/features/finance/obligation-quick-amounts";
import { previewCents } from "@/features/finance/money";
import { financeBalanceShortfall } from "@/features/finance/balance-gate";
import { decimalPHPInput, financeDrawerFooter, formatHistoryDate, formatPHP } from "@/features/finance/presentation";

const logCopy = {
  debt: { amount: "Payment amount", date: "Payment date", account: "Pay from", submit: "Save payment", remaining: "Remaining debt" },
  receivable: { amount: "Collection amount", date: "Collection date", account: "Apply to account", submit: "Save collection", remaining: "Remaining collectible" },
} as const;

const panelClass = "flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0";

export function FinanceObligationLog({ o, activity }: { o: FinanceObligationsController; activity: FinanceActivityController }) {
  const editing = o.editing;
  if (!editing) return null;
  const text = logCopy[editing.kind], debt = editing.kind === "debt";
  const disabled = o.busy || o.inspecting || !!o.inspectError;
  const selected = o.pSelected;
  const accounts = activity.accounts.filter(row => row.kind === "money" && !row.archived);
  const account = accounts.find(row => row.id === o.accountId);
  const amount = previewCents(o.amount), remainingAfter = Math.max(editing.outstanding_cents - amount, 0);
  const linkedLabel = selected ? (selected.type === "expense" ? "Debt principal payment" : "Receivable collection") : "";
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `payment-error-${key}` : undefined });
  const preview = selected ? "Linking keeps the recorded cash effect and its own text; no second cash movement is posted."
    : debt ? `${formatPHP(amount)} will be deducted from ${account?.name ?? "the selected account"}. Remaining debt after payment: ${formatPHP(remainingAfter)}.`
      : `Logging this collection adds ${formatPHP(amount)} to ${account?.name ?? "the selected account"}. Remaining collectible after: ${formatPHP(remainingAfter)}. Repayments stay out of income and spending.`;
  async function submit(event: FormEvent) {
    event.preventDefault();
    await o.pay();
  }
  return <div className={panelClass}>
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      <FieldGroup className="gap-6">
        <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="payment-amount">{text.amount} (PHP)</FieldLabel>
          <MoneyInput id="payment-amount" inputMode="decimal" className="tabular-nums" placeholder="0.00" value={o.amount} disabled={disabled || !!selected} onValueChange={o.setAmount} {...invalid("amount")} />
          {!selected && <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
            {obligationQuickAmounts(editing.outstanding_cents).map(row => <Button key={row.label} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => o.setAmount(decimalPHPInput(row.cents))}>
              {row.label === "Full amount" || row.label === "Half" ? <><span className="text-muted-foreground">{row.label}</span>&nbsp;<span className="tabular-nums">{formatPHP(row.cents)}</span></> : row.label}
            </Button>)}
          </div>}
          <FieldDescription>{text.remaining}: <span className="tabular-nums">{formatPHP(editing.outstanding_cents)}</span>. {selected ? "Taken from the linked activity." : ""}</FieldDescription>
          <FieldError id="payment-error-amount">{o.errors.amount}</FieldError></Field>
        <Field><FieldLabel htmlFor="payment-text">Description (optional)</FieldLabel><Input id="payment-text" maxLength={2000} placeholder={debt ? "e.g. Partial payment" : "e.g. Partial payment, paid after reminder"} value={o.text} disabled={disabled || !!selected} onChange={e => o.setText(e.target.value)} />{selected && <FieldDescription>A linked activity keeps its own text.</FieldDescription>}</Field>
        <Field data-invalid={!!o.errors.transaction_date}><FieldLabel htmlFor="payment-date">{text.date}</FieldLabel><FinanceDateInput id="payment-date" min="1000-01-01" max="9999-12-31" value={o.date} disabled={disabled || !!selected} onChange={o.setDate} {...invalid("transaction_date")} /><FieldError id="payment-error-transaction_date">{o.errors.transaction_date}</FieldError></Field>
        <Field data-invalid={!!o.errors.account_id}><FieldLabel id="payment-account-label">{text.account}</FieldLabel>
          <FinanceAccountChoice label={text.account} accounts={accounts} value={o.accountId} onChange={o.setAccountId} disabled={disabled || !!selected} />
          <FinanceOptionStatus activity={activity} />
          <FieldError id="payment-error-account_id">{o.errors.account_id}</FieldError></Field>
        {o.paymentShortfall && <p role="alert" className="text-sm text-destructive">{o.paymentShortfall.message}</p>}
        <Field data-invalid={!!o.errors.cash_activity_id || !!o.errors.cash_activity_version}>
          {o.pSource === "new"
            ? <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => o.choosePaymentSource("existing")}>Link an existing Activity record instead</Button>
            : <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Choose an {debt ? "expense" : "income"} you already recorded. Its account, date and amount are used exactly as recorded, with no second cash effect.</p>
              {selected ? <>
                <dl className="grid gap-3 rounded-xl bg-muted/50 p-4 text-sm">
                  <div><dt className="text-muted-foreground">Linked activity</dt><dd className="font-medium">{linkedLabel} · <span className="tabular-nums">{formatPHP(selected.amount_cents)}</span></dd></div>
                  <div><dt className="text-muted-foreground">Account</dt><dd>{selected.account_name}</dd></div>
                  <div><dt className="text-muted-foreground">Transaction date</dt><dd>{formatHistoryDate(selected.transaction_date)}</dd></div>
                  <div><dt className="text-muted-foreground">Activity version</dt><dd className="tabular-nums">{selected.version}</dd></div>
                  {selected.text && <div><dt className="text-muted-foreground">Activity text</dt><dd className="whitespace-pre-wrap break-words">{selected.text}</dd></div>}
                </dl>
                <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={o.clearCandidate}>Choose a different activity</Button>
              </> : <PaymentCandidates o={o} />}
              <Button type="button" variant="outline" className="self-start" disabled={disabled} onClick={() => o.choosePaymentSource("new")}>Record new cash instead</Button>
            </div>}
          <FieldError id="payment-error-cash_activity_id">{o.errors.cash_activity_id}</FieldError>
          <FieldError id="payment-error-cash_activity_version">{o.errors.cash_activity_version}</FieldError>
        </Field>
        <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{preview} Interest and fees are separate income or expense activity.</p>
      </FieldGroup>
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale version.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      <div className={financeDrawerFooter}><Button type="button" variant="outline" disabled={disabled} onClick={() => o.setPanel("definition")}>Back</Button><Button type="submit" disabled={disabled || !!o.paymentShortfall}>{o.busy ? "Saving…" : o.pSource === "existing" ? "Review link" : text.submit}</Button></div>
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
    {o.pError ? <Alert><AlertDescription>{o.pError}<Button type="button" variant="outline" onClick={() => void o.loadCandidates(o.pOffset)}>Retry matching history</Button></AlertDescription></Alert> : o.pLoading ? <p role="status" className="text-sm text-muted-foreground">Loading matching history…</p> : o.pCandidates.length ? <>
      <p className="text-sm text-muted-foreground">{o.pTotal} eligible record{o.pTotal === 1 ? "" : "s"}. Selecting fills account, date and amount exactly as recorded.</p>
      <ul className="divide-y divide-border border-y border-border">{o.pCandidates.map(row => <li key={row.id}><button type="button" className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-muted active:bg-muted" onClick={() => o.selectCandidate(row)} aria-label={`Select ${row.type === "expense" ? "expense" : "income"} ${formatPHP(row.amount_cents)} on ${formatHistoryDate(row.transaction_date)}`}>
        <span className="min-w-0 truncate text-sm font-medium">{row.category_name ?? (row.type === "expense" ? "Expense" : "Income")}</span>
        <strong className="justify-self-end text-sm tabular-nums">{formatPHP(row.amount_cents)}</strong>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{formatHistoryDate(row.transaction_date)} · {row.account_name}</span>
        <span aria-hidden="true" />
      </button></li>)}</ul>
      {o.pTotal > 25 && <nav aria-label="Matching history pages" className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={o.pOffset === 0 || o.pLoading} onClick={() => void o.loadCandidates(Math.max(0, o.pOffset - 25))}>Previous records</Button><span className="text-sm">{o.pOffset + 1}-{Math.min(o.pOffset + 25, o.pTotal)} of {o.pTotal}</span><Button type="button" variant="outline" disabled={o.pOffset + 25 >= o.pTotal || o.pLoading} onClick={() => void o.loadCandidates(o.pOffset + 25)}>Next records</Button></nav>}
    </> : <p className="text-sm text-muted-foreground">No eligible {o.editing?.kind === "debt" ? "expense" : "income"} history to link. Record the payment as new cash instead, or add the transaction in Activity and load this list again.</p>}
  </div>;
}

export function FinanceObligationAddMore({ o, activity }: { o: FinanceObligationsController; activity: FinanceActivityController }) {
  const editing = o.editing;
  if (!editing) return null;
  const debt = editing.kind === "debt", disabled = o.busy || o.inspecting || !!o.inspectError;
  const accounts = activity.accounts.filter(row => row.kind === "money" && !row.archived);
  const account = accounts.find(row => row.id === o.accountId);
  const amount = previewCents(o.amount);
  const shortfall = debt ? null : financeBalanceShortfall({ accounts: activity.accounts, account_id: o.accountId, amount: o.amount, subject: "lending" });
  const preview = debt ? `${formatPHP(amount)} will be added to ${account?.name ?? "the selected account"}. You will owe ${editing.name} ${formatPHP(editing.outstanding_cents + amount)} in total.`
    : `${formatPHP(amount)} will leave ${account?.name ?? "the selected account"}. ${editing.name} will owe you ${formatPHP(editing.outstanding_cents + amount)} in total.`;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `more-error-${key}` : undefined });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await o.save();
  }
  return <div className={panelClass}>
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      <FieldGroup className="gap-6">
        <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="more-amount">{debt ? "Amount borrowed" : "Amount lent"} (PHP)</FieldLabel><MoneyInput id="more-amount" inputMode="decimal" className="tabular-nums" placeholder="0.00" value={o.amount} disabled={disabled} onValueChange={o.setAmount} {...invalid("amount")} /><FieldError id="more-error-amount">{o.errors.amount}</FieldError></Field>
        <Field data-invalid={!!o.errors.account_id}><FieldLabel id="more-account-label">{debt ? "Received in" : "Lent from"}</FieldLabel>
          <FinanceAccountChoice label={debt ? "Received in" : "Lent from"} accounts={accounts} value={o.accountId} onChange={o.setAccountId} disabled={disabled} />
          <FinanceOptionStatus activity={activity} />
          <FieldError id="more-error-account_id">{o.errors.account_id}</FieldError></Field>
        {shortfall && <p role="alert" className="text-sm text-destructive">{shortfall.message}</p>}
        <Field data-invalid={!!o.errors.transaction_date}><FieldLabel htmlFor="more-date">Date the money moved</FieldLabel><FinanceDateInput id="more-date" min="1000-01-01" max="9999-12-31" value={o.date} disabled={disabled} onChange={o.setDate} {...invalid("transaction_date")} /><FieldError id="more-error-transaction_date">{o.errors.transaction_date}</FieldError></Field>
        <Field><FieldLabel htmlFor="more-text">Description (optional)</FieldLabel><Input id="more-text" maxLength={2000} value={o.text} disabled={disabled} onChange={e => o.setText(e.target.value)} /></Field>
        <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{preview} Kept out of income and spending.</p>
      </FieldGroup>
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale version.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      <div className={financeDrawerFooter}><Button type="button" variant="outline" disabled={disabled} onClick={() => o.setPanel("definition")}>Back</Button><Button type="submit" disabled={disabled || !!shortfall}>{o.busy ? "Saving…" : debt ? "Save borrowing" : "Save lending"}</Button></div>
    </form>
  </div>;
}
