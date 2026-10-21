"use client";

import type { FinancePlan } from "../planning-types";
import type { FinanceSchedule } from "../recurrence-types";
import type { FinanceActivityController } from "../use-finance-activity";
import type { FinancePlanningController } from "../use-finance-planning";
import type { FinanceRecurrenceController } from "../use-finance-recurrence";
import { useFinanceScheduleEntry } from "../use-finance-schedule-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinancePlanCategories } from "./FinancePlanCategories";
import { FinancePlanToggle } from "./FinancePlanToggle";
import { FinanceScheduleFields } from "./FinanceScheduleFields";
import { FinanceSchedulePreview } from "./FinanceSchedulePreview";
import { FinanceOptionStatus } from "./FinanceActivity";
import { MoneyInput } from "./MoneyInput";
import type { ReminderOptions } from "./FinancePlans";

// This drawer keeps its own scroll body, so the footer is a plain flex child
// flush to the drawer bottom instead of the shared sticky footer helper.
const planDrawerFooter =
  "flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-background px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6";

export function FinancePlanningForm({
  schedule,
  occurrence,
  activity,
  recurrence,
  planning,
  reminders,
  initialRecurring,
  editSchedule = false,
  onClose,
  onRefresh,
  onBusyChange,
}: {
  schedule: FinanceSchedule | null;
  occurrence: FinancePlan | null;
  activity: FinanceActivityController;
  recurrence: FinanceRecurrenceController;
  planning: FinancePlanningController;
  reminders: ReminderOptions;
  initialRecurring: boolean;
  editSchedule?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const form = useFinanceScheduleEntry(
    schedule,
    occurrence,
    activity,
    recurrence,
    planning,
    onClose,
    onBusyChange,
    initialRecurring,
    editSchedule,
  );
  const {
    type,
    amount,
    setAmount,
    account,
    setAccount,
    category,
    subcategory,
    setSubcategory,
    text,
    setText,
    association,
    changeAssociation,
    recurring,
    setRecurring,
    loggedDate,
    setLoggedDate,
    time,
    setTime,
    timezone,
    busy,
    errors,
    invalid,
  } = form;
  const loggedDateError = recurring
    ? form.startLater
      ? undefined
      : errors.start_date
    : errors.due_date;
  return (
    <form
      onSubmit={form.submit}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
        {occurrence && (
          <p className="text-sm text-muted-foreground">
            Changes apply from the occurrence due {occurrence.due_date}. Posted
            history stays unchanged.
          </p>
        )}
        {!occurrence && schedule && (
          <p className="text-sm text-muted-foreground">
            Changes apply to upcoming occurrences. Recorded history stays
            unchanged.
          </p>
        )}
        <FieldGroup className="gap-6">
          <Field>
            <FieldLabel id="schedule-type-label">Plan type</FieldLabel>
            <ToggleGroup
              aria-labelledby="schedule-type-label"
              value={[type]}
              onValueChange={(values) => {
                if (values[0]) form.changeType(values[0]);
              }}
              variant="outline"
              disabled={busy}
              className="w-full"
            >
              <ToggleGroupItem value="expense" className="min-h-11 flex-1">
                Expense
              </ToggleGroupItem>
              <ToggleGroupItem value="income" className="min-h-11 flex-1">
                Income
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-text">Plan name (optional)</FieldLabel>
            <Input
              id="schedule-text"
              maxLength={2000}
              placeholder={
                type === "income"
                  ? "e.g. Monthly salary"
                  : "e.g. Monthly internet bill"
              }
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field data-invalid={!!errors.amount}>
            <FieldLabel htmlFor="schedule-amount">Amount (PHP)</FieldLabel>
            <MoneyInput
              id="schedule-amount"
              inputMode="decimal"
              value={amount}
              disabled={busy}
              placeholder="0.00"
              onValueChange={(value) => setAmount(value)}
              {...invalid("amount")}
            />
            <FieldError id="schedule-error-amount">{errors.amount}</FieldError>
          </Field>
          <Field data-invalid={!!errors.account_id}>
            <FieldLabel htmlFor="schedule-account_id">Account</FieldLabel>
            <NativeSelect
              id="schedule-account_id"
              className="w-full"
              value={account}
              disabled={busy}
              onChange={(event) => setAccount(event.target.value)}
              {...invalid("account_id")}
            >
              <NativeSelectOption value="">
                Choose a money account
              </NativeSelectOption>
              {activity.accounts
                .filter(
                  (row) =>
                    row.kind === "money" && (!row.archived || row.id === account),
                )
                .map((row) => (
                  <NativeSelectOption key={row.id} value={row.id}>
                    {row.name}
                    {row.archived ? " (archived)" : ""}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            <FieldError id="schedule-error-account_id">
              {errors.account_id}
            </FieldError>
          </Field>
          <FinancePlanCategories
            activity={activity}
            type={type}
            value={category}
            onChange={form.changeCategory}
            subcategoryId={subcategory}
            onSubcategoryChange={setSubcategory}
            disabled={busy}
            id="schedule-category"
          />
          <FieldGroup className="rounded-xl bg-muted/50 p-4">
            <FieldGroup className="sm:flex-row">
              <Field data-invalid={!!loggedDateError}>
                <FieldLabel htmlFor="schedule-logged-date">Logged at</FieldLabel>
                <FinanceDateInput
                  id="schedule-logged-date"
                  min="1000-01-01"
                  max="9999-12-31"
                  value={loggedDate}
                  disabled={busy}
                  onChange={setLoggedDate}
                  aria-invalid={!!loggedDateError}
                  aria-describedby={
                    loggedDateError ? "schedule-error-logged-date" : undefined
                  }
                />
                <FieldError id="schedule-error-logged-date">
                  {loggedDateError}
                </FieldError>
              </Field>
              <Field data-invalid={!!errors.logged_time}>
                <FieldLabel htmlFor="schedule-logged_time">Time</FieldLabel>
                <Input
                  id="schedule-logged_time"
                  type="time"
                  value={time}
                  disabled={busy}
                  onChange={(event) => setTime(event.target.value)}
                  {...invalid("logged_time")}
                />
                <FieldError id="schedule-error-logged_time">
                  {errors.logged_time}
                </FieldError>
              </Field>
            </FieldGroup>
            <FieldDescription>
              {recurring
                ? "The first planned date, unless you choose Start later."
                : "When you expect this income or expense."}{" "}
              Time zone: {timezone}.
            </FieldDescription>
          </FieldGroup>
          {!schedule && (
            <FinancePlanToggle
              id="schedule-recurring"
              label={`Set as recurring ${type}`}
              checked={recurring}
              onChange={setRecurring}
              disabled={busy}
            />
          )}
          {recurring && <FinanceScheduleFields form={form} />}
          {recurring && (
            <details
              className="rounded-xl border border-border p-4"
              open={association ? true : undefined}
            >
              <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                More options
              </summary>
              <FieldGroup className="mt-4">
                {recurring &&
                  (reminders.error ? (
                    <Alert>
                      <AlertDescription>
                        {reminders.error}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={reminders.reload}
                        >
                          Retry reminder options
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : reminders.loading ? (
                    <p role="status" className="text-sm">
                      Loading reminder options…
                    </p>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="schedule-obligation_id">
                        Link a {type === "expense" ? "debt" : "receivable"}{" "}
                        (optional)
                      </FieldLabel>
                      <NativeSelect
                        id="schedule-obligation_id"
                        className="w-full"
                        value={association}
                        disabled={busy}
                        onChange={(event) =>
                          changeAssociation(event.target.value)
                        }
                        {...invalid("obligation_id")}
                      >
                        <NativeSelectOption value="">
                          Not associated
                        </NativeSelectOption>
                        {reminders.obligations
                          .filter(
                            (row) =>
                              row.kind ===
                              (type === "expense" ? "debt" : "receivable"),
                          )
                          .map((row) => (
                            <NativeSelectOption key={row.id} value={row.id}>
                              {row.name}
                            </NativeSelectOption>
                          ))}
                      </NativeSelect>
                      {reminders.hasMore && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={reminders.loadMore}
                        >
                          Load more obligations
                        </Button>
                      )}
                      <FieldDescription>
                        Linked payments use manual handling so you can confirm
                        principal, fees and cash before posting.
                      </FieldDescription>
                      <FieldError id="schedule-error-obligation_id">
                        {errors.obligation_id}
                      </FieldError>
                    </Field>
                  ))}
              </FieldGroup>
            </details>
          )}
          <FinanceSchedulePreview
            form={form}
            schedule={schedule}
            occurrence={occurrence}
          />
          <FinanceOptionStatus activity={activity} />
          <FieldError id="schedule-error-submit">{errors.submit}</FieldError>
          {(recurrence.saveError || planning.saveError) && (
            <Alert>
              <AlertDescription>
                {recurrence.saveError || planning.saveError} Retry unchanged
                fields safely.
                {schedule && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={onRefresh}
                  >
                    Refresh schedule before editing
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </div>
      <div className={planDrawerFooter}>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy
            ? "Saving…"
            : schedule
              ? "Save this and future changes"
              : `Save ${type} plan`}
        </Button>
      </div>
    </form>
  );
}
