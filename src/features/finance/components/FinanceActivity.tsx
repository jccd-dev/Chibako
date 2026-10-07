"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceTransaction } from "@/features/finance/activity-types";
import { FinanceCorrection } from "./FinanceCorrection";
import { FinanceDateInput, FinanceMonthInput } from "./FinanceDateInputs";
import { FinanceNoteLinks, FinanceNotePicker } from "./FinanceNoteLinks";
import { FinanceTransferFields } from "./FinanceTransferFields";
import { useFinanceEntry } from "@/features/finance/use-finance-entry";
import type { ActivityFilters, FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP } from "@/features/finance/presentation";

const activityLabel = (type: FinanceTransaction["type"]) => ({ income: "Income", expense: "Expense", transfer: "Transfer", reconciliation: "Reconciliation", valuation: "Asset valuation", refund: "Refund", borrowing: "Borrowing", lending: "Lending" })[type];
const principalPaymentLabel = (row: Pick<FinanceTransaction, "type" | "obligation_payment">) => row.obligation_payment ? row.type === "expense" ? "Debt principal payment" : "Receivable collection" : activityLabel(row.type);

export function FinanceMonthlyTotals({ activity }: { activity: FinanceActivityController }) {
  return <section aria-label="Monthly income and spending" className="border-b border-border py-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Income and spending</h2>
      <label className="flex items-center gap-3 text-sm">Report month<FinanceMonthInput aria-label="Report month" value={activity.month} min="1000-01" max="9999-12" onChange={activity.setMonth} className="w-auto" /></label>
    </div>
    {activity.totalsError ? <Alert className="mt-4"><AlertDescription>{activity.totalsError}<Button variant="outline" className={control} onClick={() => void activity.refreshTotals()}>Retry totals</Button></AlertDescription></Alert> : activity.totals ? <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div><dt className="text-sm text-muted-foreground">Income</dt><dd className="mt-2 break-words text-2xl font-semibold tabular-nums" data-testid="finance-income-total">{formatPHP(activity.totals.income_cents)}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Spending</dt><dd className="mt-2 break-words text-2xl font-semibold tabular-nums" data-testid="finance-expense-total">{formatPHP(activity.totals.expense_cents)}</dd></div>
    </dl> : <p role="status" className="py-5 text-sm text-muted-foreground">Loading monthly totals…</p>}
    <p className="mt-3 text-sm text-muted-foreground">By the calendar day money moved. Refunds reduce spending on their refund date, never income. Openings, transfers, borrowing, lending, principal payments and adjustments are excluded; transfer fees count as spending.</p>
  </section>;
}

export function FinanceActivityList({ activity }: { activity: FinanceActivityController }) {
  const [draft, setDraft] = useState<ActivityFilters>(activity.filters);
  const [selected, setSelected] = useState<FinanceTransaction | null>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const inspectSequence = useRef(0);
  useEffect(() => { setDraft(activity.filters); }, [activity.filters]);
  async function inspect(id: string) {
    const sequence = ++inspectSequence.current;
    activity.resetSave(); setInspectionId(id); setSelected(null); setInspectionError("");
    try { const detail = await activity.inspect(id); if (sequence === inspectSequence.current) setSelected(detail); }
    catch (error) { if (sequence === inspectSequence.current) setInspectionError(error instanceof Error ? error.message : "Could not inspect transaction."); }
  }
  function change(key: keyof ActivityFilters, value: string) {
    if (key === "hidden" || key === "reverted") {
      if (value === "false" || value === "true" || value === "all") setDraft(current => ({ ...current, [key]: value }));
    } else setDraft(current => ({ ...current, [key]: value }));
  }
  return <section aria-label="Activity history">
    <h2 className="text-lg font-semibold">Activity</h2>
    <p className="mt-1 text-sm text-muted-foreground">Find the transactions behind your balances. Select a record to inspect or correct it.</p>
    {activity.filters.obligation_id && <p className="mt-3 text-sm">Showing this obligation's linked activity, including hidden and reverted records. Clear filters to return to all activity.</p>}
    <form onSubmit={event => { event.preventDefault(); activity.applyFilters(draft); }} className="my-6">
      <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field><FieldLabel htmlFor="activity-search">Search activity</FieldLabel><Input id="activity-search" value={draft.q} maxLength={200} onChange={event => change("q", event.target.value)} className={control} /><FieldDescription>Search transaction text, categories and tags.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="activity-account">Filter account</FieldLabel><select id="activity-account" className={select} value={draft.account_id} onChange={event => change("account_id", event.target.value)}><option value="">All accounts</option>{activity.accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.archived ? " (archived)" : ""}</option>)}</select></Field>
        <Field><FieldLabel htmlFor="activity-type">Filter type</FieldLabel><select id="activity-type" className={select} value={draft.type} onChange={event => change("type", event.target.value)}><option value="">All activity</option><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option><option value="reconciliation">Reconciliation</option><option value="valuation">Asset valuation</option><option value="refund">Refund</option><option value="borrowing">Borrowing</option><option value="lending">Lending</option></select></Field>
        <Field><FieldLabel htmlFor="activity-from">From date</FieldLabel><FinanceDateInput id="activity-from" min="1000-01-01" max="9999-12-31" value={draft.date_from} onChange={value => change("date_from", value)} /></Field>
        <Field><FieldLabel htmlFor="activity-to">To date</FieldLabel><FinanceDateInput id="activity-to" min={draft.date_from || "1000-01-01"} max="9999-12-31" value={draft.date_to} onChange={value => change("date_to", value)} /></Field>
        <Field><FieldLabel htmlFor="activity-category">Filter category</FieldLabel><select id="activity-category" className={select} value={draft.category_id} onChange={event => change("category_id", event.target.value)}><option value="">All categories</option>{activity.classifications.filter(item => item.kind === "category" && (!draft.type || item.type === (draft.type === "refund" ? "expense" : draft.type))).map(item => <option key={item.id} value={item.id}>{item.type === "income" ? "Income" : "Expense"}: {item.name}{item.parent_id ? " (subcategory)" : ""}{item.archived ? " (archived)" : ""}</option>)}</select></Field>
        <Field><FieldLabel htmlFor="activity-hidden">Hidden records</FieldLabel><select id="activity-hidden" className={select} value={draft.hidden} onChange={event => change("hidden", event.target.value)}><option value="false">Visible only</option><option value="true">Hidden only</option><option value="all">Visible and hidden</option></select></Field>
        <Field><FieldLabel htmlFor="activity-reverted">Reverted records</FieldLabel><select id="activity-reverted" className={select} value={draft.reverted} onChange={event => change("reverted", event.target.value)}><option value="false">Active effects only</option><option value="true">Reverted only</option><option value="all">Active and reverted</option></select></Field>
      </FieldGroup>
      <div className="mt-4 flex flex-wrap gap-3"><Button type="submit" className={control}>Apply filters</Button><Button type="button" variant="outline" className={control} onClick={activity.clearFilters}>Clear filters</Button></div>
    </form>
    <FinanceOptionStatus activity={activity} />
    {activity.loadError ? <Alert><AlertDescription>{activity.loadError}<Button variant="outline" className={control} onClick={() => void activity.refreshHistory()}>Retry activity</Button></AlertDescription></Alert> : activity.loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading activity…</p> : activity.page?.transactions.length ? <ul className="divide-y divide-border">
      {activity.page.transactions.map(row => <li key={row.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-muted active:bg-muted" onClick={() => void inspect(row.id)} aria-label={`Inspect ${row.type} ${formatPHP(row.amount_cents)} on ${row.transaction_date}`}>
        <div className="min-w-0 flex-1 basis-40"><p className="break-words text-sm font-medium">{row.obligation_payment ? principalPaymentLabel(row) : row.type === "income" || row.type === "expense" ? row.category_name ?? "Uncategorized" : activityLabel(row.type)}{row.subcategory_name ? ` / ${row.subcategory_name}` : ""}</p><p className="mt-1 break-words text-sm text-muted-foreground">{row.transaction_date} · {row.account_name}{row.destination_account_name ? ` to ${row.destination_account_name}` : ""}{row.linked_record_id ? " · Transfer fee" : ""}{row.hidden ? " · Hidden" : ""}{row.reverted ? " · Reverted" : ""}</p></div>
        <p className="text-right text-sm"><span className="block">{row.obligation_payment ? principalPaymentLabel(row) : activityLabel(row.type)}</span><strong className="tabular-nums">{formatPHP(row.amount_cents)}</strong></p>
      </button></li>)}
    </ul> : <p className="py-8 text-sm text-muted-foreground">No matching activity. Add a transaction or clear your filters.</p>}
    {activity.page && activity.page.total > 25 && <nav aria-label="Activity pages" className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={activity.offset === 0 || activity.loading} onClick={() => activity.setOffset(Math.max(0, activity.offset - 25))}>Previous activity</Button><span className="text-sm">{activity.offset + 1}-{Math.min(activity.offset + 25, activity.page.total)} of {activity.page.total}</span><Button variant="outline" className={control} disabled={activity.offset + 25 >= activity.page.total || activity.loading} onClick={() => activity.setOffset(activity.offset + 25)}>Next activity</Button></nav>}
    <Sheet open={inspectionId !== null} onOpenChange={open => { if (!open && !activity.busy) { inspectSequence.current++; setInspectionId(null); } }}>
      <SheetContent className={financeSheet} showCloseButton={false}>
        <SheetHeader className="border-b border-border p-6"><SheetTitle>Transaction details</SheetTitle><SheetDescription>Dated financial activity. Correct mistakes together. Delete hides without cancelling effects; Revert cancels once. Refunds reduce spending on the date money returns.</SheetDescription></SheetHeader>
        <div className="flex flex-1 flex-col gap-5 p-6">
          {inspectionError ? <Alert><AlertDescription>{inspectionError}<Button variant="outline" className={control} onClick={() => { if (inspectionId) void inspect(inspectionId); }}>Retry inspection</Button></AlertDescription></Alert> : selected ? <dl className="grid gap-4 text-sm">
            <div><dt className="text-muted-foreground">Type</dt><dd>{selected.obligation_payment ? principalPaymentLabel(selected) : activityLabel(selected.type)}</dd></div>
            <div><dt className="text-muted-foreground">Amount</dt><dd className="text-xl font-semibold tabular-nums">{formatPHP(selected.amount_cents)}</dd></div>
            <div><dt className="text-muted-foreground">Account</dt><dd className="break-words">{selected.account_name}</dd></div>
            {selected.obligation_id && <div><dt className="text-muted-foreground">Linked obligation</dt><dd>{selected.obligation_payment ? "This activity backs principal. Corrections, hiding and reverting update cash and outstanding principal together here and reopen settlement when the obligation was closed. Its category is excluded from income and spending reports." : "Cash and principal change together. Inspect outstanding principal, payments and write-offs in Planning. Neither borrowing nor lending counts as income or spending."}</dd></div>}
            {selected.destination_account_name && <div><dt className="text-muted-foreground">Destination account</dt><dd className="break-words">{selected.destination_account_name}</dd></div>}
            {selected.fee_transaction_id && <div><dt className="text-muted-foreground">Separate transfer fee</dt><dd><Button variant="outline" className={control} disabled={activity.busy} onClick={() => void inspect(selected.fee_transaction_id!)}>Inspect fee</Button></dd></div>}
            {selected.expense_id && <div><dt className="text-muted-foreground">Original expense</dt><dd><Button variant="outline" className={control} disabled={activity.busy} onClick={() => void inspect(selected.expense_id!)}>Inspect original expense</Button></dd></div>}
            {selected.linked_record_id && <div><dt className="text-muted-foreground">Linked transfer</dt><dd><Button variant="outline" className={control} disabled={activity.busy} onClick={() => void inspect(selected.linked_record_id!)}>Inspect transfer</Button></dd></div>}
            {selected.compared_balance_cents != null && <div><dt className="text-muted-foreground">Derived balance before adjustment</dt><dd>{formatPHP(selected.compared_balance_cents)}</dd></div>}
            {selected.actual_balance_cents != null && <div><dt className="text-muted-foreground">Actual balance / value</dt><dd>{formatPHP(selected.actual_balance_cents)}</dd></div>}
            <div><dt className="text-muted-foreground">Transaction date</dt><dd>{selected.transaction_date}</dd></div>
            {(selected.type === "income" || selected.type === "expense") && <div><dt className="text-muted-foreground">Category</dt><dd className="break-words">{selected.category_name ?? "Uncategorized"}{selected.subcategory_name ? ` / ${selected.subcategory_name}` : ""}</dd></div>}
            <div><dt className="text-muted-foreground">Transaction text</dt><dd className="whitespace-pre-wrap break-words">{selected.text || "No additional text."}</dd></div>
            <div><dt className="text-muted-foreground">Tags</dt><dd className="break-words">{selected.tag_ids?.map(id => activity.classifications.find(tag => tag.id === id)?.name ?? "Saved tag").join(", ") || "No tags."}</dd></div>
            <div><dt className="text-muted-foreground">Recorded at</dt><dd>{selected.created_at ? new Date(selected.created_at * 1000).toLocaleString() : "Unavailable"}</dd></div>
          </dl> : <p role="status">Loading transaction…</p>}
          {selected && <FinanceOptionStatus activity={activity} />}
          {selected && <FinanceNoteLinks key={`notes:${selected.id}:${selected.version}`} record={selected} activity={activity} onSaved={id => void inspect(id)} />}
          {selected && <FinanceCorrection key={`${selected.id}:${selected.version}`} record={selected} activity={activity} onSaved={id => void inspect(id)} />}
          <Button variant="outline" disabled={activity.busy} className={`${control} mt-auto self-end`} onClick={() => { inspectSequence.current++; setInspectionId(null); }}>Close details</Button>
        </div>
      </SheetContent>
    </Sheet>
  </section>;
}

export function FinanceOptionStatus({ activity }: { activity: FinanceActivityController }) {
  return <div className="flex flex-col gap-3">
    {activity.optionsError && <Alert><AlertDescription>{activity.optionsError}<Button className={control} variant="outline" onClick={() => void activity.refreshOptions()}>Retry options</Button></AlertDescription></Alert>}
    {(activity.accountTotal > activity.accounts.length || activity.classificationTotal > activity.classifications.length) && <div className="flex flex-wrap gap-3">
      {activity.accountTotal > activity.accounts.length && <Button type="button" variant="outline" className={control} onClick={() => void activity.loadMoreOptions("accounts")}>Load more account options</Button>}
      {activity.classificationTotal > activity.classifications.length && <Button type="button" variant="outline" className={control} onClick={() => void activity.loadMoreOptions("classifications")}>Load more categories and tags</Button>}
    </div>}
  </div>;
}

export function FinanceTransactionEntry({ activity, open, onClose }: { activity: FinanceActivityController; open: boolean; onClose: () => void }) {
  const entry = useFinanceEntry(activity, open);
  const { type, changeType, amount, setAmount, accountId, setAccountId, date, setDate, categoryId, changeCategory, subcategoryId, setSubcategoryId, text, setText, tagIds, setTagIds, notes, setNotes, errors, save } = entry;
  const accountKey = type === "transfer" ? "source_account_id" : "account_id";
  const amountRef = useRef<HTMLInputElement>(null);
  const categories = activity.classifications.filter(item => item.kind === "category" && item.type === type && !item.parent_id && !item.archived);
  const subcategories = activity.classifications.filter(item => item.parent_id === categoryId && !item.archived);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const another = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another";
    const result = await save(another);
    if (result.invalidField) document.getElementById(`transaction-${result.invalidField}`)?.focus();
    if (!result.saved) return;
    if (another) amountRef.current?.focus();
    else onClose();
  }
  const errorProps = (key: string) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `error-${key}` : undefined });
  return <Sheet open={open} onOpenChange={value => { if (!value && !activity.busy) onClose(); }}>
    <SheetContent className={financeSheet} showCloseButton={false}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>Add transaction</SheetTitle><SheetDescription>Record money that moved. Expense is the default. PHP only.</SheetDescription></SheetHeader>
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6 p-6">
        <FieldGroup>
          <Field><FieldLabel htmlFor="transaction-type">Transaction type</FieldLabel><select id="transaction-type" className={select} value={type} disabled={activity.busy} onChange={event => changeType(event.target.value as "income" | "expense" | "transfer")}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></Field>
          <Field data-invalid={!!errors.amount}><FieldLabel htmlFor="transaction-amount">Amount (PHP)</FieldLabel><Input ref={amountRef} id="transaction-amount" inputMode="decimal" value={amount} disabled={activity.busy} onChange={event => setAmount(event.target.value)} className={`${control} tabular-nums`} {...errorProps("amount")} /><FieldDescription>Positive amount, with at most two decimal places.</FieldDescription><FieldError id="error-amount">{errors.amount}</FieldError></Field>
          <Field data-invalid={!!errors[accountKey]}><FieldLabel htmlFor={`transaction-${accountKey}`}>{type === "transfer" ? "Source account" : "Account"}</FieldLabel><select id={`transaction-${accountKey}`} className={select} value={accountId} disabled={activity.busy} onChange={event => setAccountId(event.target.value)} {...errorProps(accountKey)}><option value="">Choose a money account</option>{activity.accounts.filter(account => !account.archived && account.kind === "money").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select><FieldError id={`error-${accountKey}`}>{errors[accountKey]}</FieldError></Field>
          {type === "transfer" && <FinanceTransferFields activity={activity} entry={entry} />}
          <Field data-invalid={!!errors.transaction_date}><FieldLabel htmlFor="transaction-transaction_date">Transaction date</FieldLabel><FinanceDateInput id="transaction-transaction_date" min="1000-01-01" max="9999-12-31" value={date} disabled={activity.busy} onChange={setDate} {...errorProps("transaction_date")} /><FieldDescription>The calendar day money moved, not when you entered it.</FieldDescription><FieldError id="error-transaction_date">{errors.transaction_date}</FieldError></Field>
          {type !== "transfer" && <Field><FieldLabel htmlFor="transaction-category">Category</FieldLabel><select id="transaction-category" className={select} value={categoryId} disabled={activity.busy} onChange={event => changeCategory(event.target.value)}><option value="">Uncategorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>}
          {type !== "transfer" && subcategories.length > 0 && <Field><FieldLabel htmlFor="transaction-subcategory">Subcategory</FieldLabel><select id="transaction-subcategory" className={select} value={subcategoryId} disabled={activity.busy} onChange={event => setSubcategoryId(event.target.value)}><option value="">No subcategory</option>{subcategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        </FieldGroup>
        {!activity.accounts.some(account => !account.archived && account.kind === "money") && <p className="text-sm text-muted-foreground">Create a money account in Manage before recording activity.</p>}
        <FinanceOptionStatus activity={activity} />
        <details><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Additional details</summary><FieldGroup className="mt-3">
          <Field><FieldLabel htmlFor="transaction-text">Transaction text</FieldLabel><Textarea id="transaction-text" value={text} maxLength={2000} disabled={activity.busy} onChange={event => setText(event.target.value)} className="min-h-24 text-sm" /></Field>
          <FieldSet><FieldLegend>Tags</FieldLegend>{activity.classifications.filter(item => item.kind === "tag" && !item.archived).map(tag => <label key={tag.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={tagIds.includes(tag.id)} disabled={activity.busy || (!tagIds.includes(tag.id) && tagIds.length >= 20)} onChange={event => setTagIds(current => event.target.checked ? [...current, tag.id] : current.filter(id => id !== tag.id))} />{tag.name}</label>)}<FieldDescription>Manage tags in the Manage tab. Up to 20 per transaction.</FieldDescription></FieldSet>
          <FieldSet><FieldLegend>Optional Note links</FieldLegend><FinanceNotePicker notes={notes} onChange={setNotes} disabled={activity.busy} /></FieldSet>
        </FieldGroup></details>
        {activity.saveError && <Alert><AlertDescription>{activity.saveError} Your entries are kept. Retry to safely reuse the same request.</AlertDescription></Alert>}
        <div className="mt-auto flex flex-wrap justify-end gap-3 pt-4"><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={onClose}>Cancel</Button><Button type="submit" name="another" variant="outline" className={control} disabled={activity.busy}>Save and add another</Button><Button type="submit" className={control} disabled={activity.busy}>{activity.busy ? "Saving…" : "Save transaction"}</Button></div>
      </form>
    </SheetContent>
  </Sheet>;
}
