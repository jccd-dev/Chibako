"use client";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { interestFrequencySchema } from "../types";
import type { useFinanceAccountEditor } from "../use-finance-account-editor";
import { interestFrequencyLabels } from "./FinanceInterestStatus";

export function FinanceInterestFields({ editor, busy }: {
  editor: ReturnType<typeof useFinanceAccountEditor>;
  busy: boolean;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="finance-interest-rate">Annual interest rate (%)</FieldLabel>
        <Input
          id="finance-interest-rate"
          inputMode="decimal"
          placeholder="Off"
          maxLength={16}
          value={editor.interestRate}
          disabled={busy}
          onChange={(event) => editor.setInterestRate(event.target.value)}
        />
        <FieldDescription>
          Optional. Chibako posts modeled interest automatically from each day&apos;s closing balance, using a 365-day year and
          Philippine calendar days. Your bank&apos;s figure can differ. Clear the rate to stop new interest; earned interest still
          pays on its scheduled date.
        </FieldDescription>
      </Field>
      {editor.interestRate.trim() && (
        <>
          <Field>
            <FieldLabel htmlFor="finance-interest-frequency">Interest payout</FieldLabel>
            <NativeSelect
              id="finance-interest-frequency"
              className="w-full"
              value={editor.interestFrequency}
              disabled={busy}
              onChange={(event) => {
                const frequency = interestFrequencySchema.safeParse(event.target.value);
                if (frequency.success) editor.setInterestFrequency(frequency.data);
              }}
            >
              {interestFrequencySchema.options.map((frequency) => (
                <NativeSelectOption key={frequency} value={frequency}>{interestFrequencyLabels[frequency]}</NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>Each period pays on the first day after it closes.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="finance-interest-tax">Withholding tax (%)</FieldLabel>
            <Input
              id="finance-interest-tax"
              inputMode="decimal"
              maxLength={8}
              value={editor.interestTax}
              disabled={busy}
              onChange={(event) => editor.setInterestTax(event.target.value)}
            />
            <FieldDescription>Payouts are recorded after this tax.</FieldDescription>
          </Field>
        </>
      )}
    </>
  );
}
