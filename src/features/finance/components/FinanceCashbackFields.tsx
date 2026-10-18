"use client";

import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import type { useFinanceEntry } from "../use-finance-entry";
import { formatPHP } from "../presentation";
import { MoneyInput } from "./MoneyInput";

export function FinanceCashbackFields({ entry, disabled }: {
  entry: ReturnType<typeof useFinanceEntry>;
  disabled: boolean;
}) {
  const error = entry.errors.cashback_value;
  return (
    <>
      <Field>
        <FieldLabel id="transaction-cashback-label">Cashback</FieldLabel>
        <ToggleGroup
          aria-labelledby="transaction-cashback-label"
          value={[entry.cashbackMode]}
          disabled={disabled}
          variant="outline"
          onValueChange={(values) => {
            const mode = values[0];
            if (mode === "off" || mode === "percent" || mode === "amount") entry.changeCashbackMode(mode);
          }}
        >
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
          <ToggleGroupItem value="percent" aria-label="Cashback percentage">%</ToggleGroupItem>
          <ToggleGroupItem value="amount">Amount</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {entry.cashbackMode !== "off" && (
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="transaction-cashback_value">
            {entry.cashbackMode === "percent" ? "Cashback (%)" : "Cashback (PHP)"}
          </FieldLabel>
          {entry.cashbackMode === "amount" ? (
            <MoneyInput
              id="transaction-cashback_value"
              inputMode="decimal"
              value={entry.cashbackValue}
              onValueChange={(value) => entry.setCashbackValue(value)}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby="transaction-cashback-help error-cashback_value"
            />
          ) : (
            <Input
              id="transaction-cashback_value"
              inputMode="decimal"
              value={entry.cashbackValue}
              onChange={(event) => entry.setCashbackValue(event.target.value)}
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby="transaction-cashback-help error-cashback_value"
            />
          )}
          <FieldDescription id="transaction-cashback-help">
            Recorded as Cashback income in the same account on the expense date.
            {entry.cashbackMode === "percent" && " Up to two decimal places; rounded to the nearest cent, with half-cents rounded up."}
            {entry.cashbackPreview !== null && ` Income: ${formatPHP(entry.cashbackPreview)}.`}
          </FieldDescription>
          <FieldError id="error-cashback_value">{error}</FieldError>
        </Field>
      )}
    </>
  );
}
