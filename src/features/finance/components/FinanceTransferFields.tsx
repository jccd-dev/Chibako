"use client";

import { Checkbox } from "@/components/ui/checkbox";

import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import type { useFinanceEntry } from "@/features/finance/use-finance-entry";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { MoneyInput } from "./MoneyInput";

import { FinanceAccountChoice } from "./FinanceAccountChoice";
export function FinanceTransferFields({ activity, entry }: { activity: FinanceActivityController; entry: ReturnType<typeof useFinanceEntry> }) {
  const errorProps = (key: string) => ({ "aria-invalid": !!entry.errors[key], "aria-describedby": entry.errors[key] ? `error-${key}` : undefined });
  return <>
    <Field data-invalid={!!entry.errors.destination_account_id}><FieldLabel id="transaction-destination_account_id-label">Destination account</FieldLabel><FinanceAccountChoice label="Destination account" value={entry.destinationId} onChange={entry.setDestinationId} disabled={activity.busy} accounts={activity.accounts.filter(account => !account.archived && (account.kind === "money" || account.kind === "credit") && account.id !== entry.accountId)} /><FieldError id="error-destination_account_id">{entry.errors.destination_account_id}</FieldError></Field>
    <label className="flex min-h-7 items-center gap-2 text-xs"><Checkbox checked={entry.hasFee} disabled={activity.busy} onCheckedChange={checked => entry.setHasFee(checked)} />Include a separate transfer fee</label>
    {entry.hasFee && <>
      <Field data-invalid={!!entry.errors.fee_amount}><FieldLabel htmlFor="transaction-fee_amount">Fee amount (PHP)</FieldLabel><MoneyInput id="transaction-fee_amount" inputMode="decimal" value={entry.feeAmount} disabled={activity.busy} onValueChange={entry.setFeeAmount} {...errorProps("fee_amount")} /><FieldDescription>A separate expense in Fees, deducted from the source with the transfer.</FieldDescription><FieldError id="error-fee_amount">{entry.errors.fee_amount}</FieldError></Field>
    </>}
  </>;
}
