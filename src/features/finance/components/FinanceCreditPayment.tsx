"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { FinanceAccount } from "../types";
import type { FinanceTransaction } from "../activity-types";
import type { FinanceCreditCycle } from "../credit-cycle-types";
import { cashbackSplit } from "../cashback-split";
import { formatHistoryDate, formatPHP } from "../presentation";
import { useFinanceCreditPayment } from "../use-finance-credit-payment";
import { FinanceDateInput } from "./FinanceDateInputs";
import { MoneyInput } from "./MoneyInput";

type Props = {
  card: FinanceAccount; cycle: FinanceCreditCycle; olderUnpaidCents: number; includedThroughDate: string | null;
  cash: FinanceAccount[]; rewards: FinanceTransaction[]; onSaved: () => void;
};

export function FinanceCreditPayment({ onSaved, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { card, cycle } = props;
  return <Dialog open={open} onOpenChange={next => { if (next || !busy) setOpen(next); }}>
    <DialogTrigger render={<Button type="button" variant="outline" />}>Record payment</DialogTrigger>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg motion-reduce:animate-none" showCloseButton={false}>
      <DialogHeader className="shrink-0 border-b border-border p-4">
        <DialogTitle>Record credit card payment</DialogTitle>
        <DialogDescription>{card.name} · statement {formatHistoryDate(cycle.statement_date)}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <PaymentForm {...props} onBusy={setBusy} onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />
      </div>
    </DialogContent>
  </Dialog>;
}

function PaymentForm({ card, cycle, olderUnpaidCents, includedThroughDate, cash, rewards, onSaved, onBusy, onCancel }: Props & { onBusy: (busy: boolean) => void; onCancel: () => void }) {
  // Mounted only while the dialog is open, so every opening starts from fresh defaults.
  const form = useFinanceCreditPayment(card, cycle, olderUnpaidCents, includedThroughDate, cash, rewards, onSaved);
  useEffect(() => { onBusy(form.busy); return () => onBusy(false); }, [form.busy, onBusy]);
  const { preview } = form;
  return <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void form.submit(); }}>
    {olderUnpaidCents > 0 && <p className="text-sm text-muted-foreground">Older unpaid statements ({formatPHP(olderUnpaidCents)}) are settled first, so this payment may reduce them before this statement.</p>}
    <Field>
      <FieldLabel htmlFor="card-pay-source">Pay from cash account</FieldLabel>
      <NativeSelect id="card-pay-source" className="w-full" value={form.source} onChange={event => form.setSource(event.target.value)} disabled={form.busy}>
        <NativeSelectOption value="">{preview.cashCents > 0 ? "Choose an account" : "None (cashback only)"}</NativeSelectOption>
        {cash.map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name} · {formatPHP(account.balance_cents)}</NativeSelectOption>)}
      </NativeSelect>
    </Field>
    <Field>
      <FieldLabel htmlFor="card-pay-amount">Cash amount (PHP)</FieldLabel>
      <MoneyInput id="card-pay-amount" inputMode="decimal" value={form.amount} onValueChange={form.setAmount} disabled={form.busy} />
      <FieldDescription>Defaults to {olderUnpaidCents > 0 ? "older unpaid statements plus this statement’s remaining balance" : "the remaining balance"}, minus selected cashback. Enter less for a partial or early payment, or 0 to settle with cashback only.</FieldDescription>
    </Field>
    <Field>
      <FieldLabel htmlFor="card-pay-date">Payment date</FieldLabel>
      <FinanceDateInput id="card-pay-date" required max={form.today} value={form.date} onChange={form.setDate} disabled={form.busy} />
    </Field>
    {rewards.length > 0 && <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Use pending cashback (optional)</legend>
      {rewards.map(reward => {
        const pick = form.pickFor(reward); const { applied, pending } = cashbackSplit(reward);
        return <div key={reward.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <Checkbox checked={pick.on} onCheckedChange={on => form.patch(reward.id, { on: !!on }, reward)} disabled={form.busy} />
            <span>Purchase {formatHistoryDate(reward.transaction_date)} · pending {formatPHP(pending)}{applied > 0 ? ` · ${formatPHP(applied)} already applied` : ""}</span>
          </label>
          {pick.on && <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`pay-cb-amount-${reward.id}`}>Amount (PHP)</FieldLabel>
              <MoneyInput id={`pay-cb-amount-${reward.id}`} inputMode="decimal" value={pick.amount} onValueChange={value => form.patch(reward.id, { amount: value }, reward)} disabled={form.busy} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`pay-cb-date-${reward.id}`}>Credited date</FieldLabel>
              <FinanceDateInput id={`pay-cb-date-${reward.id}`} min={reward.transaction_date} max={form.today} value={pick.date} onChange={value => form.patch(reward.id, { date: value }, reward)} disabled={form.busy} />
            </Field>
          </div>}
        </div>;
      })}
    </fieldset>}
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm tabular-nums" aria-live="polite">
      <dt>Cash debit</dt><dd className="text-right">{formatPHP(preview.cashCents)}</dd>
      <dt>Cashback credit</dt><dd className="text-right">{formatPHP(preview.cashbackCents)}</dd>
      {preview.includedCashbackCents > 0 && <dt className="col-span-2 text-xs text-muted-foreground">{formatPHP(preview.includedCashbackCents)} cashback already included in confirmed statement</dt>}
      <dt className="font-medium">Reduces card balance</dt><dd className="text-right font-medium">{formatPHP(preview.applied)}</dd>
      {olderUnpaidCents > 0 && <><dt>Applied to older unpaid statements</dt><dd className="text-right">{formatPHP(preview.toOlder)}</dd></>}
      <dt>Remaining on this statement</dt><dd className="text-right">{formatPHP(preview.remaining)}</dd>
    </dl>
    {preview.olderLeft > 0 && <p className="text-sm text-muted-foreground">{formatPHP(preview.olderLeft)} of older statements stays unpaid, so none of this payment reaches this statement.</p>}
    {preview.over > 0 && <p className="text-sm text-muted-foreground">{formatPHP(preview.over)} exceeds this statement and goes to later balances.</p>}
    {form.error && <Alert><AlertDescription>{form.error} Your entries are kept.</AlertDescription></Alert>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancel} disabled={form.busy}>Cancel</Button>
      <Button type="submit" disabled={form.busy}>{form.busy ? "Recording…" : "Record payment"}</Button>
    </div>
  </form>;
}
