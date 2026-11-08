"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import type { FinanceTransaction } from "../activity-types";
import type { FinanceActivityController } from "../use-finance-activity";
import { formatPHP, localCalendarDate, decimalPHPInput } from "../presentation";
import { previewCents } from "../money";
import { DateInput } from "@/components/ui/date-inputs";
import { cashbackSplit } from "../cashback-split";
import { MoneyInput } from "./MoneyInput";

export function FinanceCashbackAction({ record, activity, onSaved }: {
  record: FinanceTransaction;
  activity: FinanceActivityController;
  onSaved: (id: string) => void;
}) {
  const { total, applied, pending } = cashbackSplit(record);
  const [date, setDate] = useState(localCalendarDate());
  const [amount, setAmount] = useState(decimalPHPInput(pending));
  const today = localCalendarDate();
  const cents = previewCents(amount);
  const invalid = cents <= 0 || cents > pending || !date || date < record.transaction_date || date > today;
  async function run(apply: boolean) {
    const result = await activity.changeCashback(record.id, apply, {
      version: record.version, ...(apply ? { amount, transaction_date: date } : {}),
    });
    if (result) onSaved(record.id);
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); if (!invalid) void run(true); }}>
      <p className="text-sm text-muted-foreground">
        Cashback {formatPHP(total)}: applied {formatPHP(applied)}, pending {formatPHP(pending)}.
        {pending > 0 ? " Your balance changes only for the amount you apply." : " Fully applied."}
      </p>
      {pending > 0 && <>
        <Field>
          <FieldLabel htmlFor="cashback-amount">Amount to apply (PHP)</FieldLabel>
          <MoneyInput id="cashback-amount" inputMode="decimal" value={amount} onValueChange={setAmount} disabled={activity.busy} aria-invalid={cents > pending} />
          <FieldDescription>Up to {formatPHP(pending)}. Apply the rest later.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="cashback-credited-date">Cashback credited date</FieldLabel>
          <DateInput id="cashback-credited-date" min={record.transaction_date} max={today} value={date} onChange={setDate} disabled={activity.busy} />
          <FieldDescription>The date the bank credited the reward, on or after the purchase date.</FieldDescription>
        </Field>
        <Button type="submit" variant="outline" disabled={activity.busy || invalid}>{activity.busy ? "Saving…" : "Apply cashback"}</Button>
      </>}
      {applied > 0 && <Button type="button" variant="outline" disabled={activity.busy} onClick={() => void run(false)}>
        {activity.busy ? "Saving…" : `Undo all applied cashback (${formatPHP(applied)})`}
      </Button>}
    </form>
  );
}
