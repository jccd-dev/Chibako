"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { useFinanceAccountEditor } from "../use-finance-account-editor";
import { formatPHP } from "../presentation";
import { MoneyInput } from "./MoneyInput";

const days = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));

export function FinanceCreditFields({ editor, creating, busy }: {
  editor: ReturnType<typeof useFinanceAccountEditor>;
  creating: boolean;
  busy: boolean;
}) {
  const afterStatement = editor.dueMode === "after_statement";
  return (
    <>
      <Field>
        <FieldLabel htmlFor="finance-credit-limit">Credit limit (PHP)</FieldLabel>
        <MoneyInput
          id="finance-credit-limit"
          inputMode="decimal"
          required
          pattern="\d{1,3}(,\d{3})*(\.\d{1,2})?"
          value={editor.creditLimit}
          disabled={busy}
          onValueChange={editor.setCreditLimit}
        />
      </Field>
      {creating && (
        <>
          <Field orientation="horizontal">
            <Checkbox
              id="finance-has-owed"
              checked={editor.hasOwed}
              disabled={busy}
              onCheckedChange={editor.setHasOwed}
            />
            <div>
              <FieldLabel htmlFor="finance-has-owed">I already owe on this card</FieldLabel>
              <FieldDescription>Starts the card with an existing owed balance. It does not count as spending.</FieldDescription>
            </div>
          </Field>
          {editor.hasOwed && (
            <Field>
              <FieldLabel htmlFor="finance-owed">Existing owed balance (PHP)</FieldLabel>
              <MoneyInput
                id="finance-owed"
                inputMode="decimal"
                pattern="\d{1,3}(,\d{3})*(\.\d{1,2})?"
                value={editor.owed}
                disabled={busy}
                onValueChange={editor.setOwed}
              />
            </Field>
          )}
        </>
      )}
      <Field>
        <FieldLabel htmlFor="finance-statement-day">Statement day</FieldLabel>
        <NativeSelect
          id="finance-statement-day"
          className="w-full"
          value={editor.statementDay}
          disabled={busy}
          onChange={(event) => editor.setStatementDay(event.target.value)}
        >
          <NativeSelectOption value="">Not set</NativeSelectOption>
          {days(31).map((day) => <NativeSelectOption key={day} value={day}>{day}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription>The day each billing cycle closes. Later days fall on the last day of shorter months.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="finance-payment-account">Payment account</FieldLabel>
        <NativeSelect id="finance-payment-account" className="w-full" value={editor.paymentAccountId} disabled={busy} onChange={event => editor.setPaymentAccountId(event.target.value)}>
          <NativeSelectOption value="">Not linked</NativeSelectOption>
          {editor.paymentAccounts.map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription>The full card debt is held from this account’s spendable cash. Spending beyond free cash warns and still saves.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel id="finance-due-type-label">Due date type</FieldLabel>
        <ToggleGroup
          aria-labelledby="finance-due-type-label"
          value={[editor.dueMode]}
          disabled={busy}
          spacing={0}
          onValueChange={(values) => {
            if (values[0] === "fixed_day" || values[0] === "after_statement") {
              editor.setDueMode(values[0]);
              editor.setDueValue("");
            }
          }}
        >
          <ToggleGroupItem value="fixed_day">Fixed day</ToggleGroupItem>
          <ToggleGroupItem value="after_statement">Days after statement</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor="finance-due-value">{afterStatement ? "Days after statement" : "Due day"}</FieldLabel>
        <NativeSelect
          id="finance-due-value"
          className="w-full"
          value={editor.dueValue}
          disabled={busy}
          onChange={(event) => editor.setDueValue(event.target.value)}
        >
          <NativeSelectOption value="">Not set</NativeSelectOption>
          {days(afterStatement ? 60 : 31).map((day) => <NativeSelectOption key={day} value={day}>{day}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription>Optional. Leave unset to track limit and balance only.</FieldDescription>
      </Field>
      {creating && editor.creditPreview && (
        <p role="status" className="text-sm">
          Used credit <strong className="tabular-nums">{formatPHP(editor.creditPreview.used_cents)}</strong>
          {" · "}Available <strong className="tabular-nums">{formatPHP(editor.creditPreview.available_cents)}</strong>
        </p>
      )}
    </>
  );
}
