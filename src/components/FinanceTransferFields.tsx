"use client";

import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import type { useFinanceEntry } from "@/features/finance/use-finance-entry";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeControl as control, financeSelect as select } from "@/features/finance/presentation";

export function FinanceTransferFields({ activity, entry }: { activity: FinanceActivityController; entry: ReturnType<typeof useFinanceEntry> }) {
  const categories = activity.classifications.filter(item => item.kind === "category" && item.type === "expense" && !item.parent_id && !item.archived);
  const subcategories = activity.classifications.filter(item => item.parent_id === entry.feeCategoryId && !item.archived);
  const errorProps = (key: string) => ({ "aria-invalid": !!entry.errors[key], "aria-describedby": entry.errors[key] ? `error-${key}` : undefined });
  return <>
    <Field data-invalid={!!entry.errors.destination_account_id}><FieldLabel htmlFor="transaction-destination_account_id">Destination account</FieldLabel><select id="transaction-destination_account_id" className={select} value={entry.destinationId} disabled={activity.busy} onChange={event => entry.setDestinationId(event.target.value)} {...errorProps("destination_account_id")}><option value="">Choose a different money account</option>{activity.accounts.filter(account => !account.archived && account.kind === "money" && account.id !== entry.accountId).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select><FieldError id="error-destination_account_id">{entry.errors.destination_account_id}</FieldError></Field>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={entry.hasFee} disabled={activity.busy} className="size-4 accent-primary" onChange={event => entry.setHasFee(event.target.checked)} />Include a separate transfer fee</label>
    {entry.hasFee && <>
      <Field data-invalid={!!entry.errors.fee_amount}><FieldLabel htmlFor="transaction-fee_amount">Fee amount (PHP)</FieldLabel><Input id="transaction-fee_amount" inputMode="decimal" className={control} value={entry.feeAmount} disabled={activity.busy} onChange={event => entry.setFeeAmount(event.target.value)} {...errorProps("fee_amount")} /><FieldDescription>A separate expense, deducted from the source with the transfer.</FieldDescription><FieldError id="error-fee_amount">{entry.errors.fee_amount}</FieldError></Field>
      <Field data-invalid={!!entry.errors.fee_category_id}><FieldLabel htmlFor="transaction-fee_category_id">Fee expense category</FieldLabel><select id="transaction-fee_category_id" className={select} value={entry.feeCategoryId} disabled={activity.busy} onChange={event => entry.changeFeeCategory(event.target.value)} {...errorProps("fee_category_id")}><option value="">Choose an expense category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><FieldDescription>Create fee categories in Manage if none are available.</FieldDescription><FieldError id="error-fee_category_id">{entry.errors.fee_category_id}</FieldError></Field>
      {subcategories.length > 0 && <Field><FieldLabel htmlFor="transaction-fee_subcategory_id">Fee subcategory</FieldLabel><select id="transaction-fee_subcategory_id" className={select} value={entry.feeSubcategoryId} disabled={activity.busy} onChange={event => entry.setFeeSubcategoryId(event.target.value)}><option value="">No subcategory</option>{subcategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
    </>}
  </>;
}
