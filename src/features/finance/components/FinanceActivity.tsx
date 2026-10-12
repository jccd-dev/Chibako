"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceTransaction } from "@/features/finance/activity-types";
import { FinanceCorrection } from "./FinanceCorrection";
import { FinanceHistoryFilters } from "./FinanceHistoryFilters";
import { FinanceDateInput, FinanceMonthInput } from "./FinanceDateInputs";
import { FinanceNoteLinks, FinanceNotePicker } from "./FinanceNoteLinks";
import { FinanceTransferFields } from "./FinanceTransferFields";
import { FinanceCashbackFields } from "./FinanceCashbackFields";
import { useFinanceEntry } from "@/features/finance/use-finance-entry";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeSheet, formatPHP } from "@/features/finance/presentation";

const activityLabel = (type: FinanceTransaction["type"]) =>
  ({
    income: "Income",
    expense: "Expense",
    transfer: "Transfer",
    reconciliation: "Reconciliation",
    valuation: "Asset valuation",
    refund: "Refund",
    borrowing: "Borrowing",
    lending: "Lending",
  })[type];
const principalPaymentLabel = (
  row: Pick<FinanceTransaction, "type" | "obligation_payment">,
) =>
  row.obligation_payment
    ? row.type === "expense"
      ? "Debt principal payment"
      : "Receivable collection"
    : activityLabel(row.type);

export function FinanceMonthlyTotals({
  activity,
}: {
  activity: FinanceActivityController;
}) {
  return (
    <section
      aria-label="Monthly income and spending"
      className="border-b border-border py-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Income and spending</h2>
        <label className="flex items-center gap-3 text-sm">
          Report month
          <FinanceMonthInput
            aria-label="Report month"
            value={activity.month}
            min="1000-01"
            max="9999-12"
            onChange={activity.setMonth}
            className="w-auto"
          />
        </label>
      </div>
      {activity.totalsError ? (
        <Alert className="mt-4">
          <AlertDescription>
            {activity.totalsError}
            <Button
              variant="outline"
              onClick={() => void activity.refreshTotals()}
            >
              Retry totals
            </Button>
          </AlertDescription>
        </Alert>
      ) : activity.totals ? (
        <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Income</dt>
            <dd
              className="mt-2 break-words text-2xl font-semibold tabular-nums"
              data-testid="finance-income-total"
            >
              {formatPHP(activity.totals.income_cents)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Spending</dt>
            <dd
              className="mt-2 break-words text-2xl font-semibold tabular-nums"
              data-testid="finance-expense-total"
            >
              {formatPHP(activity.totals.expense_cents)}
            </dd>
          </div>
        </dl>
      ) : (
        <p role="status" className="py-5 text-sm text-muted-foreground">
          Loading monthly totals…
        </p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        By the calendar day money moved. Refunds reduce spending on their refund
        date, never income. Openings, transfers, borrowing, lending, principal
        payments and adjustments are excluded; transfer fees count as spending.
      </p>
    </section>
  );
}

export function FinanceActivityList({
  activity,
  onInspect,
}: {
  activity: FinanceActivityController;
  onInspect: (id: string) => void;
}) {
  return (
    <section aria-label="Transaction history">
      <h2 className="text-lg font-semibold">History</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Find the transactions behind your balances. Select a record to inspect
        or correct it.
      </p>
      {activity.filters.obligation_id && (
        <p className="mt-3 text-sm">
          Showing this obligation's linked activity, including hidden and
          reverted records. Clear filters to return to all activity.
        </p>
      )}
      <div className="mt-6 grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <FinanceHistoryFilters activity={activity} />
        <div className="min-w-0">
          <FinanceOptionStatus activity={activity} />
          {activity.loadError ? (
            <Alert>
              <AlertDescription>
                {activity.loadError}
                <Button
                  variant="outline"
                  onClick={() => void activity.refreshHistory()}
                >
                  Retry history
                </Button>
              </AlertDescription>
            </Alert>
          ) : activity.loading ? (
            <p role="status" className="py-6 text-sm text-muted-foreground">
              Loading history…
            </p>
          ) : activity.page?.transactions.length ? (
            <ul className="divide-y divide-border">
              {activity.page.transactions.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-muted active:bg-muted"
                    onClick={() => onInspect(row.id)}
                    aria-label={`Inspect ${row.type} ${formatPHP(row.amount_cents)} on ${row.transaction_date}`}
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="break-words text-sm font-medium">
                        {row.obligation_payment
                          ? principalPaymentLabel(row)
                          : row.type === "income" || row.type === "expense"
                            ? (row.category_name ?? "Uncategorized")
                            : activityLabel(row.type)}
                        {row.subcategory_name
                          ? ` / ${row.subcategory_name}`
                          : ""}
                      </p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {row.transaction_date} · {row.account_name}
                        {row.destination_account_name
                          ? ` to ${row.destination_account_name}`
                          : ""}
                        {row.cashback_expense_id ? " · Cashback" : row.linked_record_id ? " · Transfer fee" : ""}
                        {row.hidden ? " · Hidden" : ""}
                        {row.reverted ? " · Reverted" : ""}
                      </p>
                    </div>
                    <p className="text-right text-sm">
                      <span className="block">
                        {row.obligation_payment
                          ? principalPaymentLabel(row)
                          : activityLabel(row.type)}
                      </span>
                      <strong className="tabular-nums">
                        {formatPHP(row.amount_cents)}
                      </strong>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              No matching transactions. Add a transaction or clear your filters.
            </p>
          )}
          {activity.page && activity.page.total > 25 && (
            <nav
              aria-label="History pages"
              className="mt-5 flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={activity.offset === 0 || activity.loading}
                onClick={() =>
                  activity.setOffset(Math.max(0, activity.offset - 25))
                }
              >
                Previous history
              </Button>
              <span className="text-sm">
                {activity.offset + 1}-
                {Math.min(activity.offset + 25, activity.page.total)} of{" "}
                {activity.page.total}
              </span>
              <Button
                variant="outline"
                disabled={
                  activity.offset + 25 >= activity.page.total ||
                  activity.loading
                }
                onClick={() => activity.setOffset(activity.offset + 25)}
              >
                Next history
              </Button>
            </nav>
          )}
        </div>
      </div>
    </section>
  );
}

export function FinanceTransactionDetails({
  activity,
  inspectionId,
  onClose,
}: {
  activity: FinanceActivityController;
  inspectionId: string | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<FinanceTransaction | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [detailId, setDetailId] = useState(inspectionId);
  const [reload, setReload] = useState(0);
  const inspectSequence = useRef(0);
  const { inspect: loadDetail, resetSave } = activity;
  useEffect(() => {
    const sequence = ++inspectSequence.current;
    setSelected(null);
    setInspectionError("");
    if (!inspectionId || !detailId) return;
    resetSave();
    void loadDetail(detailId)
      .then((detail) => {
        if (sequence === inspectSequence.current) setSelected(detail);
      })
      .catch((error) => {
        if (sequence === inspectSequence.current)
          setInspectionError(
            error instanceof Error
              ? error.message
              : "Could not inspect transaction.",
          );
      });
    return () => {
      inspectSequence.current++;
    };
  }, [inspectionId, detailId, reload, loadDetail, resetSave]);
  function inspect(id: string) {
    inspectSequence.current++;
    setSelected(null);
    setDetailId(id);
    setReload((value) => value + 1);
  }
  return (
    <Dialog
      open={inspectionId !== null}
      onOpenChange={(open) => {
        if (!open && !activity.busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl motion-reduce:animate-none"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b border-border p-4">
          <DialogTitle>Transaction details</DialogTitle>
          <DialogDescription>
            Dated financial activity. Correct mistakes together. Delete hides
            without cancelling effects; Revert cancels once. Refunds reduce
            spending on the date money returns.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
          {inspectionError ? (
            <Alert>
              <AlertDescription>
                {inspectionError}
                <Button
                  variant="outline"
                  onClick={() => {
                    if (detailId) void inspect(detailId);
                  }}
                >
                  Retry inspection
                </Button>
              </AlertDescription>
            </Alert>
          ) : selected ? (
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Type</dt>
                <dd>
                  {selected.obligation_payment
                    ? principalPaymentLabel(selected)
                    : activityLabel(selected.type)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {formatPHP(selected.amount_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Account</dt>
                <dd className="break-words">{selected.account_name}</dd>
              </div>
              {selected.obligation_id && (
                <div>
                  <dt className="text-muted-foreground">Linked obligation</dt>
                  <dd>
                    {selected.obligation_payment
                      ? "This activity backs principal. Corrections, hiding and reverting update cash and outstanding principal together here and reopen settlement when the obligation was closed. Its category is excluded from income and spending reports."
                      : "Cash and principal change together. Inspect outstanding principal, payments and write-offs in Planning. Neither borrowing nor lending counts as income or spending."}
                  </dd>
                </div>
              )}
              {selected.destination_account_name && (
                <div>
                  <dt className="text-muted-foreground">Destination account</dt>
                  <dd className="break-words">
                    {selected.destination_account_name}
                  </dd>
                </div>
              )}
              {selected.fee_transaction_id && (
                <div>
                  <dt className="text-muted-foreground">
                    Separate transfer fee
                  </dt>
                  <dd>
                    <Button
                      variant="outline"
                      disabled={activity.busy}
                      onClick={() => void inspect(selected.fee_transaction_id!)}
                    >
                      Inspect fee
                    </Button>
                  </dd>
                </div>
              )}
              {selected.cashback_transaction_id && (
                <div>
                  <dt className="text-muted-foreground">Cashback income</dt>
                  <dd>
                    <Button variant="outline" disabled={activity.busy} onClick={() => void inspect(selected.cashback_transaction_id!)}>
                      Inspect cashback
                    </Button>
                  </dd>
                </div>
              )}
              {selected.expense_id && (
                <div>
                  <dt className="text-muted-foreground">Original expense</dt>
                  <dd>
                    <Button
                      variant="outline"
                      disabled={activity.busy}
                      onClick={() => void inspect(selected.expense_id!)}
                    >
                      Inspect original expense
                    </Button>
                  </dd>
                </div>
              )}
              {selected.linked_record_id && (
                <div>
                  <dt className="text-muted-foreground">{selected.cashback_expense_id ? "Original expense" : "Linked transfer"}</dt>
                  <dd>
                    <Button
                      variant="outline"
                      disabled={activity.busy}
                      onClick={() => void inspect(selected.linked_record_id!)}
                    >
                      {selected.cashback_expense_id ? "Inspect original expense" : "Inspect transfer"}
                    </Button>
                  </dd>
                </div>
              )}
              {selected.compared_balance_cents != null && (
                <div>
                  <dt className="text-muted-foreground">
                    Derived balance before adjustment
                  </dt>
                  <dd>{formatPHP(selected.compared_balance_cents)}</dd>
                </div>
              )}
              {selected.actual_balance_cents != null && (
                <div>
                  <dt className="text-muted-foreground">
                    Actual balance / value
                  </dt>
                  <dd>{formatPHP(selected.actual_balance_cents)}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Transaction date</dt>
                <dd>{selected.transaction_date}</dd>
              </div>
              {(selected.type === "income" || selected.type === "expense") && (
                <div>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="break-words">
                    {selected.category_name ?? "Uncategorized"}
                    {selected.subcategory_name
                      ? ` / ${selected.subcategory_name}`
                      : ""}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Transaction text</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {selected.text || "No additional text."}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tags</dt>
                <dd className="break-words">
                  {selected.tag_ids
                    ?.map(
                      (id) =>
                        activity.classifications.find((tag) => tag.id === id)
                          ?.name ?? "Saved tag",
                    )
                    .join(", ") || "No tags."}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Recorded at</dt>
                <dd>
                  {selected.created_at
                    ? new Date(selected.created_at * 1000).toLocaleString()
                    : "Unavailable"}
                </dd>
              </div>
            </dl>
          ) : (
            <p role="status">Loading transaction…</p>
          )}
          {selected && <FinanceOptionStatus activity={activity} />}
          {selected && (
            <FinanceNoteLinks
              key={`notes:${selected.id}:${selected.version}`}
              record={selected}
              activity={activity}
              onSaved={(id) => void inspect(id)}
            />
          )}
          {selected && (
            <FinanceCorrection
              key={`${selected.id}:${selected.version}`}
              record={selected}
              activity={activity}
              onSaved={(id) => void inspect(id)}
            />
          )}
          <Button
            variant="outline"
            disabled={activity.busy}
            className="mt-auto self-end"
            onClick={onClose}
          >
            Close details
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FinanceOptionStatus({
  activity,
}: {
  activity: FinanceActivityController;
}) {
  return (
    <div className="flex flex-col gap-3">
      {activity.optionsError && (
        <Alert>
          <AlertDescription>
            {activity.optionsError}
            <Button
              variant="outline"
              onClick={() => void activity.refreshOptions()}
            >
              Retry options
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {(activity.accountTotal > activity.accounts.length ||
        activity.classificationTotal > activity.classifications.length) && (
        <div className="flex flex-wrap gap-3">
          {activity.accountTotal > activity.accounts.length && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void activity.loadMoreOptions("accounts")}
            >
              Load more account options
            </Button>
          )}
          {activity.classificationTotal > activity.classifications.length && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void activity.loadMoreOptions("classifications")}
            >
              Load more categories and tags
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function FinanceTransactionEntry({
  activity,
  open,
  onClose,
}: {
  activity: FinanceActivityController;
  open: boolean;
  onClose: () => void;
}) {
  const entry = useFinanceEntry(activity, open);
  const {
    type,
    changeType,
    amount,
    setAmount,
    accountId,
    setAccountId,
    date,
    setDate,
    categoryId,
    changeCategory,
    subcategoryId,
    setSubcategoryId,
    text,
    setText,
    tagIds,
    setTagIds,
    notes,
    setNotes,
    errors,
    save,
  } = entry;
  const accountKey = type === "transfer" ? "source_account_id" : "account_id";
  const amountRef = useRef<HTMLInputElement>(null);
  const categories = activity.classifications.filter(
    (item) =>
      item.kind === "category" &&
      item.type === type &&
      !item.parent_id &&
      !item.archived,
  );
  const subcategories = activity.classifications.filter(
    (item) => item.parent_id === categoryId && !item.archived,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const another =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") ===
      "another";
    const result = await save(another);
    if (result.invalidField)
      document.getElementById(`transaction-${result.invalidField}`)?.focus();
    if (!result.saved) return;
    if (another) amountRef.current?.focus();
    else onClose();
  }
  const errorProps = (key: string) => ({
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? `error-${key}` : undefined,
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value && !activity.busy) onClose();
      }}
    >
      <SheetContent className={financeSheet} showCloseButton={false}>
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>Add transaction</SheetTitle>
          <SheetDescription>
            Record money that moved. Expense is the default. PHP only.
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-1 flex-col gap-4 p-4"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="transaction-type">
                Transaction type
              </FieldLabel>
              <NativeSelect
                id="transaction-type"
                className="w-full"
                value={type}
                disabled={activity.busy}
                onChange={(event) =>
                  changeType(
                    event.target.value as "income" | "expense" | "transfer",
                  )
                }
              >
                <NativeSelectOption value="expense">Expense</NativeSelectOption>
                <NativeSelectOption value="income">Income</NativeSelectOption>
                <NativeSelectOption value="transfer">
                  Transfer
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field data-invalid={!!errors.amount}>
              <FieldLabel htmlFor="transaction-amount">Amount (PHP)</FieldLabel>
              <Input
                ref={amountRef}
                id="transaction-amount"
                inputMode="decimal"
                value={amount}
                disabled={activity.busy}
                onChange={(event) => setAmount(event.target.value)}
                className="tabular-nums"
                {...errorProps("amount")}
              />
              <FieldDescription>
                Positive amount, with at most two decimal places.
              </FieldDescription>
              <FieldError id="error-amount">{errors.amount}</FieldError>
            </Field>
            {type === "expense" && <FinanceCashbackFields entry={entry} disabled={activity.busy} />}
            <Field data-invalid={!!errors[accountKey]}>
              <FieldLabel htmlFor={`transaction-${accountKey}`}>
                {type === "transfer" ? "Source account" : "Account"}
              </FieldLabel>
              <NativeSelect
                id={`transaction-${accountKey}`}
                className="w-full"
                value={accountId}
                disabled={activity.busy}
                onChange={(event) => setAccountId(event.target.value)}
                {...errorProps(accountKey)}
              >
                <NativeSelectOption value="">
                  Choose a money account
                </NativeSelectOption>
                {activity.accounts
                  .filter(
                    (account) => !account.archived && account.kind === "money",
                  )
                  .map((account) => (
                    <NativeSelectOption key={account.id} value={account.id}>
                      {account.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <FieldError id={`error-${accountKey}`}>
                {errors[accountKey]}
              </FieldError>
            </Field>
            {type === "transfer" && (
              <FinanceTransferFields activity={activity} entry={entry} />
            )}
            <Field data-invalid={!!errors.transaction_date}>
              <FieldLabel htmlFor="transaction-transaction_date">
                Transaction date
              </FieldLabel>
              <FinanceDateInput
                id="transaction-transaction_date"
                min="1000-01-01"
                max="9999-12-31"
                value={date}
                disabled={activity.busy}
                onChange={setDate}
                {...errorProps("transaction_date")}
              />
              <FieldDescription>
                The calendar day money moved, not when you entered it.
              </FieldDescription>
              <FieldError id="error-transaction_date">
                {errors.transaction_date}
              </FieldError>
            </Field>
            {type !== "transfer" && (
              <Field>
                <FieldLabel htmlFor="transaction-category">Category</FieldLabel>
                <NativeSelect
                  id="transaction-category"
                  className="w-full"
                  value={categoryId}
                  disabled={activity.busy}
                  onChange={(event) => changeCategory(event.target.value)}
                >
                  <NativeSelectOption value="">
                    Uncategorized
                  </NativeSelectOption>
                  {categories.map((category) => (
                    <NativeSelectOption key={category.id} value={category.id}>
                      {category.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {type !== "transfer" && subcategories.length > 0 && (
              <Field>
                <FieldLabel htmlFor="transaction-subcategory">
                  Subcategory
                </FieldLabel>
                <NativeSelect
                  id="transaction-subcategory"
                  className="w-full"
                  value={subcategoryId}
                  disabled={activity.busy}
                  onChange={(event) => setSubcategoryId(event.target.value)}
                >
                  <NativeSelectOption value="">
                    No subcategory
                  </NativeSelectOption>
                  {subcategories.map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </FieldGroup>
          {!activity.accounts.some(
            (account) => !account.archived && account.kind === "money",
          ) && (
            <p className="text-sm text-muted-foreground">
              Create a money account in Accounts before recording activity.
            </p>
          )}
          <FinanceOptionStatus activity={activity} />
          <details>
            <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">
              Additional details
            </summary>
            <FieldGroup className="mt-3">
              <Field>
                <FieldLabel htmlFor="transaction-text">
                  Transaction text
                </FieldLabel>
                <Textarea
                  id="transaction-text"
                  value={text}
                  maxLength={2000}
                  disabled={activity.busy}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
              <FieldSet>
                <FieldLegend>Tags</FieldLegend>
                {activity.classifications
                  .filter((item) => item.kind === "tag" && !item.archived)
                  .map((tag) => (
                    <label
                      key={tag.id}
                      className="flex min-h-7 items-center gap-2 text-xs"
                    >
                      <Checkbox
                        checked={tagIds.includes(tag.id)}
                        disabled={
                          activity.busy ||
                          (!tagIds.includes(tag.id) && tagIds.length >= 20)
                        }
                        onCheckedChange={(checked) =>
                          setTagIds((current) =>
                            checked
                              ? [...current, tag.id]
                              : current.filter((id) => id !== tag.id),
                          )
                        }
                      />
                      {tag.name}
                    </label>
                  ))}
                <FieldDescription>
                  Manage tags in the Manage tab. Up to 20 per transaction.
                </FieldDescription>
              </FieldSet>
              <FieldSet>
                <FieldLegend>Optional Note links</FieldLegend>
                <FinanceNotePicker
                  notes={notes}
                  onChange={setNotes}
                  disabled={activity.busy}
                />
              </FieldSet>
            </FieldGroup>
          </details>
          {activity.saveError && (
            <Alert>
              <AlertDescription>
                {activity.saveError} Your entries are kept. Retry to safely
                reuse the same request.
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-auto flex flex-wrap justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={activity.busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              name="another"
              variant="outline"
              disabled={activity.busy}
            >
              Save and add another
            </Button>
            <Button type="submit" disabled={activity.busy}>
              {activity.busy ? "Saving…" : "Save transaction"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
