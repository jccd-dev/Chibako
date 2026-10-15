"use client";

import type { FinanceScheduleEntry } from "../use-finance-schedule-entry";
import { repeatPresets } from "../repeat-presets";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinancePlanToggle } from "./FinancePlanToggle";

export function FinanceScheduleFields({
  form,
}: {
  form: FinanceScheduleEntry;
}) {
  const {
    type,
    busy,
    preset,
    changePreset,
    count,
    setCount,
    unit,
    changeUnit,
    handling,
    setHandling,
    association,
    startLater,
    setStartLater,
    loggedDate,
    laterDate,
    setLaterDate,
    endCondition,
    changeEndCondition,
    end,
    setEnd,
    payments,
    setPayments,
    total,
    setTotal,
    errors,
    invalid,
  } = form;
  return (
    <>
      <FieldSet>
        <FieldLegend id="schedule-repeat-label">Repeat</FieldLegend>
        <ToggleGroup
          aria-labelledby="schedule-repeat-label"
          value={[preset]}
          onValueChange={(values) => {
            if (values[0]) changePreset(values[0]);
          }}
          variant="outline"
          disabled={busy}
          className="w-full flex-wrap justify-start"
        >
          {repeatPresets.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="min-h-11 px-3"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="custom" className="min-h-11 px-3">
            Custom
          </ToggleGroupItem>
        </ToggleGroup>
        {preset === "custom" && (
          <FieldGroup className="sm:flex-row">
            <Field data-invalid={!!errors.interval_count}>
              <FieldLabel htmlFor="schedule-interval_count">Every</FieldLabel>
              <Input
                id="schedule-interval_count"
                type="number"
                min="1"
                max="10000"
                value={count}
                disabled={busy}
                onChange={(event) => setCount(event.target.value)}
                {...invalid("interval_count")}
              />
              <FieldError id="schedule-error-interval_count">
                {errors.interval_count}
              </FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="schedule-interval_unit">Interval</FieldLabel>
              <NativeSelect
                id="schedule-interval_unit"
                className="w-full"
                value={unit}
                disabled={busy}
                onChange={(event) => changeUnit(event.target.value)}
              >
                <NativeSelectOption value="day">Days</NativeSelectOption>
                <NativeSelectOption value="week">Weeks</NativeSelectOption>
                <NativeSelectOption value="month">Months</NativeSelectOption>
                <NativeSelectOption value="year">Years</NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
        )}
        {preset !== "custom" && (
          <FieldError>{errors.interval_count}</FieldError>
        )}
      </FieldSet>
      <FieldSet className="rounded-xl bg-muted/50 p-4">
        <FieldLegend id="schedule-handling-label">
          {type === "expense" ? "Payment handling" : "Income handling"}
        </FieldLegend>
        <ToggleGroup
          id="schedule-handling"
          aria-labelledby="schedule-handling-label"
          variant="outline"
          value={[handling]}
          disabled={busy || !!association}
          onValueChange={(values) => {
            if (values[0] === "automatic" || values[0] === "manual")
              setHandling(values[0]);
          }}
          className="w-full flex-wrap justify-start"
        >
          <ToggleGroupItem value="automatic" className="min-h-11 px-3">
            {type === "expense" ? "Auto deduct" : "Auto record"}
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" className="min-h-11 px-3">
            {type === "expense" ? "Manual mark" : "Manual confirm"}
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {association
            ? "Linked debt and receivable payments need manual confirmation of principal and cash."
            : handling === "automatic"
              ? `Chibako records and ${type === "expense" ? "deducts from" : "adds to"} your account when due, even with the browser closed. The server must be running; missed dates catch up when it restarts.`
              : `Each ${type} stays pending until you confirm it. Your balance changes only after confirmation.`}
        </FieldDescription>
        <FieldError id="schedule-error-handling">{errors.handling}</FieldError>
      </FieldSet>
      <FinancePlanToggle
        id="schedule-start-later"
        label="Start later"
        description={`Choose when this recurring ${type} begins.`}
        checked={startLater}
        onChange={setStartLater}
        disabled={busy}
      />
      {startLater && (
        <Field data-invalid={!!errors.start_date}>
          <FieldLabel htmlFor="schedule-start_date">Start date</FieldLabel>
          <FinanceDateInput
            id="schedule-start_date"
            min={loggedDate}
            max="9999-12-31"
            value={laterDate}
            onChange={setLaterDate}
            disabled={busy}
            {...invalid("start_date")}
          />
          <FieldError id="schedule-error-start_date">
            {errors.start_date}
          </FieldError>
        </Field>
      )}
      {type === "income" &&
      endCondition !== "payments" &&
      endCondition !== "total" ? (
        <FinancePlanToggle
          id="schedule-end-on-date"
          label="End on date"
          description="Stop creating future recurring income after a chosen date."
          checked={endCondition === "date"}
          onChange={(checked) =>
            changeEndCondition(checked ? "date" : "forever")
          }
          disabled={busy}
        />
      ) : (
        <FieldSet className="rounded-xl bg-muted/50 p-4">
          <FieldLegend id="schedule-ending-label">End condition</FieldLegend>
          <ToggleGroup
            aria-labelledby="schedule-ending-label"
            variant="outline"
            value={[endCondition]}
            disabled={busy}
            onValueChange={(values) => {
              if (values[0]) changeEndCondition(values[0]);
            }}
            className="w-full flex-wrap justify-start"
          >
            <ToggleGroupItem value="forever" className="min-h-11 px-3">
              Forever
            </ToggleGroupItem>
            <ToggleGroupItem value="date" className="min-h-11 px-3">
              Until date
            </ToggleGroupItem>
            <ToggleGroupItem value="payments" className="min-h-11 px-3">
              Payments
            </ToggleGroupItem>
            <ToggleGroupItem value="total" className="min-h-11 px-3">
              Total
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            {endCondition === "forever"
              ? `Keep creating this recurring ${type} until you change it.`
              : endCondition === "date"
                ? "Include occurrences on this date, then stop."
                : endCondition === "payments"
                  ? "Limit the number of scheduled payments. Skipped occurrences count toward this limit."
                  : "Cap the planned total at the current amount per payment. No partial final payment is created."}
          </FieldDescription>
        </FieldSet>
      )}
      {endCondition === "date" && (
        <Field data-invalid={!!errors.end_date}>
          <FieldLabel htmlFor="schedule-end_date">Last date</FieldLabel>
          <FinanceDateInput
            id="schedule-end_date"
            min={form.start}
            max="9999-12-31"
            value={end}
            disabled={busy}
            onChange={setEnd}
            {...invalid("end_date")}
          />
          <FieldError id="schedule-error-end_date">
            {errors.end_date}
          </FieldError>
        </Field>
      )}
      {endCondition === "payments" && (
        <Field data-invalid={!!errors.max_occurrences}>
          <FieldLabel htmlFor="schedule-max_occurrences">
            Number of scheduled payments
          </FieldLabel>
          <Input
            id="schedule-max_occurrences"
            type="number"
            min="1"
            max="4000000"
            value={payments}
            onChange={(event) => setPayments(event.target.value)}
            disabled={busy}
            {...invalid("max_occurrences")}
          />
          <FieldError id="schedule-error-max_occurrences">
            {errors.max_occurrences}
          </FieldError>
        </Field>
      )}
      {endCondition === "total" && (
        <Field data-invalid={!!errors.total_limit}>
          <FieldLabel htmlFor="schedule-total_limit">
            Planned total (PHP)
          </FieldLabel>
          <Input
            id="schedule-total_limit"
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            disabled={busy}
            {...invalid("total_limit")}
          />
          <FieldError id="schedule-error-total_limit">
            {errors.total_limit}
          </FieldError>
        </Field>
      )}
    </>
  );
}
