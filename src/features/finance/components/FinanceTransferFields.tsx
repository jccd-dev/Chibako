"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import type { useFinanceEntry } from "@/features/finance/use-finance-entry";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { MoneyInput } from "./MoneyInput";

export function FinanceTransferFields({ activity, entry }: { activity: FinanceActivityController; entry: ReturnType<typeof useFinanceEntry> }) {
  const categories = activity.classifications.filter(item => item.kind === "category" && item.type === "expense" && !item.parent_id && !item.archived);
  const subcategories = activity.classifications.filter(item => item.parent_id === entry.feeCategoryId && !item.archived);
  const errorProps = (key: string) => ({ "aria-invalid": !!entry.errors[key], "aria-describedby": entry.errors[key] ? `error-${key}` : undefined });
  return <>
    <Field data-invalid={!!entry.errors.destination_account_id}><FieldLabel htmlFor="transaction-destination_account_id">Destination account</FieldLabel><NativeSelect id="transaction-destination_account_id" className="w-full" value={entry.destinationId} disabled={activity.busy} onChange={event => entry.setDestinationId(event.target.value)} {...errorProps("destination_account_id")}><NativeSelectOption value="">Choose a different money account</NativeSelectOption>{activity.accounts.filter(account => !account.archived && account.kind === "money" && account.id !== entry.accountId).map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>)}</NativeSelect><FieldError id="error-destination_account_id">{entry.errors.destination_account_id}</FieldError></Field>
    <label className="flex min-h-7 items-center gap-2 text-xs"><Checkbox checked={entry.hasFee} disabled={activity.busy} onCheckedChange={checked => entry.setHasFee(checked)} />Include a separate transfer fee</label>
    {entry.hasFee && <>
      <Field data-invalid={!!entry.errors.fee_amount}><FieldLabel htmlFor="transaction-fee_amount">Fee amount (PHP)</FieldLabel><MoneyInput id="transaction-fee_amount" inputMode="decimal" value={entry.feeAmount} disabled={activity.busy} onValueChange={entry.setFeeAmount} {...errorProps("fee_amount")} /><FieldDescription>A separate expense, deducted from the source with the transfer.</FieldDescription><FieldError id="error-fee_amount">{entry.errors.fee_amount}</FieldError></Field>
      <Field data-invalid={!!entry.errors.fee_category_id}><FieldLabel htmlFor="transaction-fee_category_id">Fee expense category</FieldLabel><NativeSelect id="transaction-fee_category_id" className="w-full" value={entry.feeCategoryId} disabled={activity.busy} onChange={event => entry.changeFeeCategory(event.target.value)} {...errorProps("fee_category_id")}><NativeSelectOption value="">Choose an expense category</NativeSelectOption>{categories.map(category => <NativeSelectOption key={category.id} value={category.id}>{category.name}</NativeSelectOption>)}</NativeSelect><FieldDescription>Create fee categories in Manage if none are available.</FieldDescription><FieldError id="error-fee_category_id">{entry.errors.fee_category_id}</FieldError></Field>
      {subcategories.length > 0 && <Field><FieldLabel htmlFor="transaction-fee_subcategory_id">Fee subcategory</FieldLabel><NativeSelect id="transaction-fee_subcategory_id" className="w-full" value={entry.feeSubcategoryId} disabled={activity.busy} onChange={event => entry.setFeeSubcategoryId(event.target.value)}><NativeSelectOption value="">No subcategory</NativeSelectOption>{subcategories.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></Field>}
    </>}
  </>;
}
