"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceAccount } from "@/features/finance/types";
import { useFinanceAdjustment } from "@/features/finance/use-finance-adjustment";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { FinanceDateInput } from "./FinanceDateInputs";
import { financeControl as control, financeSheet, formatPHP } from "@/features/finance/presentation";

export function FinanceAdjustment({ selected, activity, onClose }: { selected: FinanceAccount | null; activity: FinanceActivityController; onClose: () => void }) {
  const adjustment = useFinanceAdjustment(activity, selected?.id ?? null);
  const asset = selected?.kind === "asset";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await adjustment.save()) onClose();
  }
  const errorProps = (key: string) => ({ "aria-invalid": !!adjustment.errors[key], "aria-describedby": adjustment.errors[key] ? `adjustment-error-${key}` : undefined });
  return <Sheet open={selected !== null} onOpenChange={open => { if (!open && !activity.busy) onClose(); }}>
    <SheetContent className={financeSheet} showCloseButton={false}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>{asset ? "Adjust asset value" : "Reconcile balance"}</SheetTitle><SheetDescription>{selected?.name}. Record a dated difference, keeping the opening and history intact. No income or spending is created.</SheetDescription></SheetHeader>
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6 p-6">
        {adjustment.loadError ? <Alert><AlertDescription>{adjustment.loadError}<Button type="button" variant="outline" className={control} onClick={adjustment.refresh}>Retry balance</Button></AlertDescription></Alert> : adjustment.account ? <>
          <dl className="text-sm"><dt className="text-muted-foreground">Current derived {asset ? "value" : "balance"}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{formatPHP(adjustment.account.balance_cents)}</dd></dl>
          <FieldGroup>
            <Field data-invalid={!!adjustment.errors.actual_balance}><FieldLabel htmlFor="adjustment-actual_balance">{asset ? "Actual asset value (PHP)" : "Actual balance (PHP)"}</FieldLabel><Input id="adjustment-actual_balance" inputMode="decimal" className={control} value={adjustment.actual} disabled={activity.busy} onChange={event => adjustment.setActual(event.target.value)} {...errorProps("actual_balance")} /><FieldDescription>A signed PHP amount with up to two decimal places. Negative balances warn but are allowed.</FieldDescription><FieldError id="adjustment-error-actual_balance">{adjustment.errors.actual_balance}</FieldError></Field>
            <Field data-invalid={!!adjustment.errors.transaction_date}><FieldLabel htmlFor="adjustment-transaction_date">{asset ? "Valuation date" : "Reconciliation date"}</FieldLabel><FinanceDateInput id="adjustment-transaction_date" min="1000-01-01" max="9999-12-31" value={adjustment.date} disabled={activity.busy} onChange={adjustment.setDate} {...errorProps("transaction_date")} /><FieldError id="adjustment-error-transaction_date">{adjustment.errors.transaction_date}</FieldError></Field>
          </FieldGroup>
          <p role="status" className="text-sm">{adjustment.difference === null ? "Enter the actual amount to compare." : `Dated difference to record: ${formatPHP(adjustment.difference)}.${asset ? " No cash will move." : ""}`}</p>
          <details><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Additional details</summary><Field className="mt-3"><FieldLabel htmlFor="adjustment-text">Adjustment text</FieldLabel><Textarea id="adjustment-text" value={adjustment.text} maxLength={2000} disabled={activity.busy} onChange={event => adjustment.setText(event.target.value)} /></Field></details>
        </> : <p role="status">Loading current balance…</p>}
        {activity.saveError && <Alert><AlertDescription>{activity.saveError} Entries are kept. Retry the save safely, or refresh the balance and compare again if it changed.</AlertDescription></Alert>}
        <div className="mt-auto flex flex-wrap justify-end gap-3 pt-4"><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={onClose}>Cancel</Button><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={adjustment.refresh}>Refresh balance</Button><Button type="submit" className={control} disabled={activity.busy || !adjustment.account}>{activity.busy ? "Saving…" : "Record difference"}</Button></div>
      </form>
    </SheetContent>
  </Sheet>;
}
