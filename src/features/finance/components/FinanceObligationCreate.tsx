"use client";

import type { FormEvent } from "react";
import { IconBuilding, IconUser, IconUsers } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinanceOptionStatus } from "./FinanceActivity";
import { FinanceAccountChoice } from "./FinanceAccountChoice";
import { MoneyInput } from "./MoneyInput";
import type { FinanceObligationsController } from "@/features/finance/use-finance-obligations";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceObligation } from "@/features/finance/obligation-types";
import { previewCents } from "@/features/finance/money";
import { financeBalanceShortfall } from "@/features/finance/balance-gate";
import { financeDrawerFooter, formatPHP } from "@/features/finance/presentation";

const copy = {
  receivable: { who: "Who owes you?", placeholder: "e.g. Anna, client, company", amount: "Amount owed", account: "Lent from", none: "Not from a tracked account", noneHint: "Record it without changing any account balance.", submit: "Create entry" },
  debt: { who: "Who is this owed to?", placeholder: "e.g. BPI, Anna, lending company", amount: "Total debt", account: "Received in", none: "No tracked account", noneHint: "Keep this loan off account balances.", submit: "Create debt" },
} as const;

export const createSheetText = {
  receivable: { eyebrow: "Money owed to you", title: "New entry", description: "Add who owes you and how much. Everything else is optional and lives under More details." },
  debt: { eyebrow: "Debt", title: "New debt", description: "Start with the total you owe. Add what you already paid, or pick the account the money arrived in." },
} as const;

export function CounterpartyChips({ value, onChange, disabled }: { value: FinanceObligation["counterparty_type"]; onChange: (next: FinanceObligation["counterparty_type"]) => void; disabled?: boolean }) {
  return <ToggleGroup aria-label="Counterparty type" value={value ? [value] : []} variant="outline" disabled={disabled} className="w-full"
    onValueChange={values => onChange(values[0] === "person" || values[0] === "entity" || values[0] === "organization" ? values[0] : null)}>
    <ToggleGroupItem value="person" className="min-h-11 flex-1"><IconUser aria-hidden="true" />Person</ToggleGroupItem>
    <ToggleGroupItem value="entity" className="min-h-11 flex-1"><IconBuilding aria-hidden="true" />Entity</ToggleGroupItem>
    <ToggleGroupItem value="organization" className="min-h-11 flex-1"><IconUsers aria-hidden="true" />Organization</ToggleGroupItem>
  </ToggleGroup>;
}

export function FinanceObligationCreate({ obligations: o, activity }: { obligations: FinanceObligationsController; activity: FinanceActivityController }) {
  const text = copy[o.kind], debt = o.kind === "debt", tracked = o.accountId !== "";
  const disabled = o.busy;
  const accounts = activity.accounts.filter(row => row.kind === "money" && !row.archived);
  const account = accounts.find(row => row.id === o.accountId);
  const total = previewCents(o.amount), paid = previewCents(o.alreadyPaid), who = o.name.trim() || (debt ? "the lender" : "they");
  const shortfall = !debt && tracked ? financeBalanceShortfall({ accounts: activity.accounts, account_id: o.accountId, amount: o.amount, subject: "lending" }) : null;
  const effect = account
    ? debt ? `${formatPHP(total)} will be added to ${account.name}. You will owe ${who} ${formatPHP(total)}. Kept out of income and spending.`
      : `${formatPHP(total)} will leave ${account.name}. ${who} will owe you ${formatPHP(total)}. Kept out of income and spending.`
    : `No account balance changes. ${formatPHP(Math.max(total - paid, 0))} will be recorded as still ${debt ? "owed by you" : "owed to you"}.`;
  const invalid = (key: string) => ({ "aria-invalid": !!o.errors[key], "aria-describedby": o.errors[key] ? `obligation-error-${key}` : undefined });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const another = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another";
    if (await o.save(another) && another) document.getElementById("obligation-name")?.focus();
  }
  return <div className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      <FieldGroup className="gap-6">
        <Field><FieldLabel id="obligation-counterparty-label">Type (optional)</FieldLabel><CounterpartyChips value={o.counterparty} onChange={o.setCounterparty} disabled={disabled} /></Field>
        <Field data-invalid={!!o.errors.name}><FieldLabel htmlFor="obligation-name">{text.who}</FieldLabel><Input id="obligation-name" maxLength={120} placeholder={text.placeholder} value={o.name} disabled={disabled} onChange={e => o.setName(e.target.value)} {...invalid("name")} /><FieldError id="obligation-error-name">{o.errors.name}</FieldError></Field>
        <Field data-invalid={!!o.errors.amount}><FieldLabel htmlFor="obligation-amount">{text.amount} (PHP)</FieldLabel><MoneyInput id="obligation-amount" inputMode="decimal" className="tabular-nums" placeholder="0.00" value={o.amount} disabled={disabled} onValueChange={o.setAmount} {...invalid("amount")} /><FieldError id="obligation-error-amount">{o.errors.amount}</FieldError></Field>
        <Field data-invalid={!!o.errors.account_id}><FieldLabel id="obligation-account-label">{text.account}</FieldLabel>
          <FinanceAccountChoice label={text.account} accounts={accounts} value={o.accountId} onChange={o.setAccountId} disabled={disabled} noneLabel={text.none} noneHint={text.noneHint} />
          <FinanceOptionStatus activity={activity} />
          <FieldError id="obligation-error-account_id">{o.errors.account_id}</FieldError></Field>
        {shortfall && <p role="alert" className="text-sm text-destructive">{shortfall.message}</p>}
        {tracked
          ? <Field data-invalid={!!o.errors.transaction_date}><FieldLabel htmlFor="obligation-date">Date the money moved</FieldLabel><FinanceDateInput id="obligation-date" min="1000-01-01" max="9999-12-31" value={o.date} disabled={disabled} onChange={o.setDate} {...invalid("transaction_date")} /><FieldError id="obligation-error-transaction_date">{o.errors.transaction_date}</FieldError></Field>
          : <Field data-invalid={!!o.errors.already_paid}><FieldLabel htmlFor="obligation-already-paid">Already paid (PHP, optional)</FieldLabel><MoneyInput id="obligation-already-paid" inputMode="decimal" className="tabular-nums" placeholder="0.00" value={o.alreadyPaid} disabled={disabled} onValueChange={o.setAlreadyPaid} {...invalid("already_paid")} /><FieldDescription>Starting progress for an existing {debt ? "debt" : "entry"}. Only available without a tracked account, because a tracked account moves the full amount.</FieldDescription><FieldError id="obligation-error-already_paid">{o.errors.already_paid}</FieldError></Field>}
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">More details</summary>
          <FieldGroup className="mt-4 gap-6">
            <Field data-invalid={!!o.errors.due_date}><FieldLabel htmlFor="obligation-due-date">Due date (optional)</FieldLabel><FinanceDateInput id="obligation-due-date" min="1000-01-01" max="9999-12-31" value={o.dueDate} disabled={disabled} onChange={o.setDueDate} {...invalid("due_date")} /><FieldError id="obligation-error-due_date">{o.errors.due_date}</FieldError></Field>
            <Field data-invalid={!!o.errors.notes}><FieldLabel htmlFor="obligation-notes">Notes (optional)</FieldLabel><Textarea id="obligation-notes" maxLength={2000} placeholder="Purpose, payment terms or reminders" value={o.notes} disabled={disabled} onChange={e => o.setNotes(e.target.value)} {...invalid("notes")} /><FieldError id="obligation-error-notes">{o.errors.notes}</FieldError></Field>
            {tracked && <Field><FieldLabel htmlFor="obligation-text">Transaction text (optional)</FieldLabel><Textarea id="obligation-text" maxLength={2000} value={o.text} disabled={disabled} onChange={e => o.setText(e.target.value)} /></Field>}
          </FieldGroup>
        </details>
        <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{effect} Interest and fees are separate income or expense activity.</p>
      </FieldGroup>
      {o.saveError && <Alert><AlertDescription>{o.saveError} Your entries are kept. Retry safely.</AlertDescription></Alert>}
      {o.errors.form && <Alert><AlertDescription>{o.errors.form}</AlertDescription></Alert>}
      {o.notice && <p role="status" className="text-sm">{o.notice}</p>}
      <div className={financeDrawerFooter}>
        <Button type="button" variant="outline" disabled={o.busy} onClick={o.close}>Cancel</Button>
        <Button type="submit" name="another" variant="outline" disabled={disabled || !!shortfall}>Save and add another</Button>
        <Button type="submit" disabled={disabled || !!shortfall}>{o.busy ? "Saving…" : text.submit}</Button>
      </div>
    </form>
  </div>;
}
