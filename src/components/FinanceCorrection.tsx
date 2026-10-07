"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { ConfirmDialog } from "./ConfirmDialog";
import { FinanceDateInput } from "./FinanceDateInputs";
import type { FinanceTransaction } from "@/features/finance/activity-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { useFinanceCorrection } from "@/features/finance/use-finance-correction";
import { financeControl as control, financeSelect as select, formatPHP } from "@/features/finance/presentation";

export function FinanceCorrection({ record, activity, onSaved }: { record: FinanceTransaction; activity: FinanceActivityController; onSaved: (id: string) => void }) {
  const edit = useFinanceCorrection(record, activity, onSaved);
  const refund = edit.mode === "refund";
  const adjustment = record.type === "reconciliation" || record.type === "valuation";
  const linked = !!record.linked_record_id;
  const blocked = activity.busy || !!record.fee_transaction_id && !edit.fee;
  const categoryType = record.type === "income" ? "income" : "expense";
  const categories = activity.classifications.filter(item => item.kind === "category" && item.type === categoryType && !item.parent_id && (!item.archived || item.id === edit.categoryId));
  const fees = activity.classifications.filter(item => item.kind === "category" && item.type === "expense" && !item.parent_id && (!item.archived || item.id === edit.feeCategoryId));
  const accounts = activity.accounts.filter(account => account.id === edit.accountId || !account.archived && account.kind === (record.type === "valuation" && !refund ? "asset" : "money"));
  const errorProps = (key: string) => ({ "aria-invalid": !!edit.errors[key], "aria-describedby": edit.errors[key] ? `correction-error-${key}` : undefined });
  const descriptions = {
    hide: record.obligation_id ? "Delete hides this activity from the default list. Cash balances, outstanding principal and reports are retained, and the payment progress stays linked. Use the hidden filter to inspect it later." : "Delete hides this activity from the default list. Its balances and reports remain unchanged. A transfer's linked fee is hidden with it. Use the hidden filter to inspect it later.",
    revert: record.type === "refund" ? "Revert cancels this refund's receiving-account credit and spending reduction. The original expense remains. This can happen only once." : record.obligation_payment ? "Revert cancels this payment's cash movement and restores outstanding principal together, once, reopening settlement if the obligation was closed. The obligation definition remains." : record.obligation_id ? "Revert cancels this cash movement and its linked principal increase together, once. The obligation definition remains." : "Revert cancels this activity's financial and reporting effects once. A transfer's linked fee is cancelled with it. Active refunds must be reverted first. This is for a mistake, not money returned by a merchant.",
    refund: `Record a real refund of PHP ${edit.amount} on ${edit.date}. This credits the receiving account and reduces spending in the original expense category on that date, never as income. The original expense remains.`,
    edit: record.obligation_payment ? "Saving updates cash and outstanding principal together and rejects overpayment. If the obligation was closed, correcting this record reopens it with the new remaining principal. Category fields are hidden: principal payments are excluded from income and spending reports." : "",
  };
  async function submit(event: FormEvent) { event.preventDefault(); await edit.submit(); }
  return <section aria-label="Correct activity" className="flex flex-col gap-5 border-t border-border pt-6">
    <div><h3 className="font-semibold">{refund ? "Record refund" : record.reverted ? "Reverted activity" : "Correct activity"}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{refund ? "Use the calendar day money actually returned. A refund is not income." : record.reverted ? "The financial effects are cancelled. This record remains available for inspection and cannot be edited or reverted again." : record.obligation_payment ? "Correct cash and outstanding principal together. Principal payments never become income or spending, and overpayment is rejected. If the obligation was closed, correcting or reverting reopens it with the new remaining principal." : record.obligation_id ? "Correct cash and obligation principal together. Due dates and obligation names are managed in Planning. Borrowing and lending stay outside income and spending." : "Replace mistaken details and account effects together. For money returned, record a dated refund instead."}</p>
      {record.hidden && <p className="mt-2 text-sm">Hidden from default Activity. Financial effects are retained unless reverted.</p>}
      {record.type === "expense" && !record.obligation_payment && <p className="mt-2 text-sm">Active refunds: {formatPHP(record.refunded_cents)} of {formatPHP(record.amount_cents)}.</p>}
    </div>
    {!record.reverted && <form onSubmit={submit} className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={!!edit.errors.amount}><FieldLabel htmlFor="correction-amount">{adjustment && !refund ? "Signed adjustment difference (PHP)" : "Amount (PHP)"}</FieldLabel><Input id="correction-amount" inputMode="decimal" value={edit.amount} onChange={event => edit.setAmount(event.target.value)} disabled={blocked} className={control} {...errorProps("amount")} />
          <FieldDescription>{adjustment && !refund ? "Correct the difference posted, not the account's current total. Positive adds value; negative removes it." : refund ? "Full or partial, up to the expense amount less active refunds." : "Positive PHP amount with at most two decimal places."}</FieldDescription><FieldError id="correction-error-amount">{edit.errors.amount}</FieldError></Field>
        <Field data-invalid={!!edit.errors.account_id}><FieldLabel htmlFor="correction-account">{refund ? "Receiving account" : record.type === "transfer" ? "Source account" : "Account"}</FieldLabel><select id="correction-account" className={select} value={edit.accountId} onChange={event => edit.setAccountId(event.target.value)} disabled={blocked || linked && !refund} {...errorProps("account_id")}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.archived ? " (archived)" : ""}</option>)}</select><FieldError id="correction-error-account_id">{edit.errors.account_id}</FieldError></Field>
        {record.type === "transfer" && !refund && <Field><FieldLabel htmlFor="correction-destination">Destination account</FieldLabel><select id="correction-destination" className={select} value={edit.destinationId} disabled={blocked} onChange={event => edit.setDestinationId(event.target.value)}>{activity.accounts.filter(account => account.id === edit.destinationId || !account.archived && account.kind === "money").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>}
        <Field data-invalid={!!edit.errors.transaction_date}><FieldLabel htmlFor="correction-date">{refund ? "Refund date" : "Transaction date"}</FieldLabel><FinanceDateInput id="correction-date" min="1000-01-01" max="9999-12-31" value={edit.date} disabled={blocked || linked && !refund} onChange={edit.setDate} {...errorProps("transaction_date")} /><FieldError id="correction-error-transaction_date">{edit.errors.transaction_date}</FieldError></Field>
        {!refund && !record.obligation_id && (record.type === "income" || record.type === "expense") && <>
          <Field><FieldLabel htmlFor="correction-category">Category</FieldLabel><select id="correction-category" value={edit.categoryId} className={select} disabled={blocked} onChange={event => { edit.setCategoryId(event.target.value); edit.setSubcategoryId(""); }}><option value="">Uncategorized</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field><FieldLabel htmlFor="correction-subcategory">Subcategory</FieldLabel><select id="correction-subcategory" value={edit.subcategoryId} className={select} disabled={blocked} onChange={event => edit.setSubcategoryId(event.target.value)}><option value="">No subcategory</option>{activity.classifications.filter(item => item.parent_id === edit.categoryId && (!item.archived || item.id === edit.subcategoryId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        </>}
        {edit.fee && !refund && <FieldSet><FieldLegend>Linked transfer fee</FieldLegend><FieldDescription>Moves with the source account and date. Only this fee counts as spending.</FieldDescription>
          <Field><FieldLabel htmlFor="correction-fee-amount">Fee amount (PHP)</FieldLabel><Input id="correction-fee-amount" inputMode="decimal" className={control} value={edit.feeAmount} disabled={blocked} onChange={event => edit.setFeeAmount(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="correction-fee-category">Fee category</FieldLabel><select id="correction-fee-category" className={select} value={edit.feeCategoryId} disabled={blocked} onChange={event => { edit.setFeeCategoryId(event.target.value); edit.setFeeSubcategoryId(""); }}><option value="">Uncategorized</option>{fees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field><FieldLabel htmlFor="correction-fee-subcategory">Fee subcategory</FieldLabel><select id="correction-fee-subcategory" className={select} value={edit.feeSubcategoryId} disabled={blocked} onChange={event => edit.setFeeSubcategoryId(event.target.value)}><option value="">No subcategory</option>{activity.classifications.filter(item => item.parent_id === edit.feeCategoryId && (!item.archived || item.id === edit.feeSubcategoryId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        </FieldSet>}
        <Field><FieldLabel htmlFor="correction-text">{refund ? "Refund text" : "Transaction text"}</FieldLabel><Textarea id="correction-text" maxLength={2000} value={edit.text} disabled={blocked} onChange={event => edit.setText(event.target.value)} /></Field>
        {!refund && <FieldSet><FieldLegend>Tags</FieldLegend>{activity.classifications.filter(item => item.kind === "tag" && (!item.archived || edit.tagIds.includes(item.id))).map(tag => <label key={tag.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={edit.tagIds.includes(tag.id)} disabled={blocked || !edit.tagIds.includes(tag.id) && edit.tagIds.length >= 20} onChange={event => edit.setTagIds(current => event.target.checked ? [...current, tag.id] : current.filter(id => id !== tag.id))} />{tag.name}</label>)}</FieldSet>}
      </FieldGroup>
      {linked && !refund && <p className="text-sm text-muted-foreground">Change the source account/date or Revert from the linked transfer. This fee's amount and category can be corrected here.</p>}
      {edit.feeError && <Alert><AlertDescription>{edit.feeError}<Button type="button" variant="outline" className={control} onClick={edit.retryFee}>Retry linked fee</Button></AlertDescription></Alert>}
      {!!record.fee_transaction_id && !edit.fee && !edit.feeError && <p role="status">Loading linked fee…</p>}
      {Object.keys(edit.errors).length > 0 && <Alert><AlertDescription>{Object.values(edit.errors).join(" ")}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-3"><Button type="submit" className={control} disabled={blocked}>{activity.busy ? "Saving…" : refund ? "Review refund" : "Save correction"}</Button>{refund && <Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={() => onSaved(record.id)}>Cancel refund</Button>}</div>
    </form>}
    {activity.saveError && <Alert><AlertDescription>{activity.saveError} Your entries are kept. Retry safely, or close and reopen to refresh a stale record.</AlertDescription></Alert>}
    {!refund && <div className="flex flex-wrap gap-3">
      {!record.hidden && <Button variant="outline" className={control} disabled={activity.busy} onClick={() => edit.confirmAction("hide")}>Delete (hide)</Button>}
      {!record.reverted && <Button variant="outline" className={control} disabled={blocked || linked} onClick={() => edit.confirmAction("revert")}>Revert</Button>}
      {record.type === "expense" && !record.obligation_payment && !record.reverted && record.refunded_cents < record.amount_cents && <Button variant="outline" className={control} disabled={activity.busy} onClick={edit.startRefund}>Record refund</Button>}
    </div>}
    <ConfirmDialog open={edit.confirmation !== null} onOpenChange={open => { if (!open) edit.setConfirmation(null); }}
      title={edit.confirmation?.action === "hide" ? "Delete without cancelling activity?" : edit.confirmation?.action === "revert" ? "Revert this activity?" : edit.confirmation?.action === "edit" ? "Correct a principal payment?" : "Record this refund?"}
      description={edit.confirmation ? descriptions[edit.confirmation.action] : ""}
      confirmLabel={edit.confirmation?.action === "hide" ? "Delete (hide only)" : edit.confirmation?.action === "revert" ? "Revert effects" : edit.confirmation?.action === "edit" ? "Save correction" : "Record refund"}
      destructive={edit.confirmation?.action === "revert"}
      onConfirm={() => { const confirmed = edit.confirmation; edit.setConfirmation(null); if (confirmed) void edit.execute(confirmed.action, confirmed.input); }} />
  </section>;
}
