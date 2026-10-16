"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceAccount } from "../types";
import type { FinanceAccountsController } from "../use-finance-accounts";
import type { FinanceActivityController } from "../use-finance-activity";
import { useFinanceAccountEditor } from "../use-finance-account-editor";
import { decimalPHP, financeDrawerFooter, financeSheet, formatPHP } from "../presentation";
import { FinanceDateInput } from "./FinanceDateInputs";
import { FinanceAccountHistory } from "./FinanceAccountHistory";
import { MoneyInput } from "./MoneyInput";

export function FinanceAccountPanel({
  selected,
  finance,
  activity,
  onClose,
  onHistory,
  onInspectTransaction,
}: {
  selected: "create" | FinanceAccount;
  finance: FinanceAccountsController;
  activity: FinanceActivityController;
  onClose: () => void;
  onHistory: (id: string) => void;
  onInspectTransaction: (id: string) => void;
}) {
  const editor = useFinanceAccountEditor(selected, finance, activity);
  const { account, adjustment, busy } = editor;
  const current = adjustment.account ?? account;
  const asset = editor.kind === "asset";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await editor.save()) onClose();
  }
  const errors = adjustment.errors;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent showCloseButton={false} className={financeSheet}>
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>
            {editor.editing
              ? account
                ? "Edit account"
                : "Add account"
              : account?.name}
          </SheetTitle>
          <SheetDescription>
            {editor.editing
              ? "Keep account details and balance together. PHP only."
              : "Account details and the activity behind its balance."}
          </SheetDescription>
        </SheetHeader>
        {!editor.editing && account ? (
          <div className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="col-span-2">
                <dt className="text-muted-foreground">
                  {asset ? "Current value" : "Net balance"}
                </dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">
                  {formatPHP(current?.balance_cents ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="mt-1">
                  {asset ? "Asset" : "Debit"}
                  {account.archived ? " / Archived" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Group</dt>
                <dd className="mt-1 break-words">
                  {editor.group || "Ungrouped"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{asset ? "Opening value" : "Spendable this month"}</dt>
                <dd className="mt-1 break-words tabular-nums">
                  {formatPHP(asset ? account.opening_balance_cents : current?.spendable_cents ?? 0)}
                </dd>
              </div>
              {!asset && (
                <>
                  <div>
                    <dt className="text-muted-foreground">Maintaining balance</dt>
                    <dd className="mt-1 tabular-nums">{formatPHP(current?.maintaining_balance_cents ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Unpaid expenses this month</dt>
                    <dd className="mt-1 tabular-nums">{formatPHP(current?.planned_expense_cents ?? 0)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-muted-foreground">Summary</dt>
                <dd className="mt-1">
                  {editor.included ? "Included" : "Excluded from totals"}
                </dd>
              </div>
            </dl>
            {adjustment.loadError && (
              <Alert>
                <AlertDescription>
                  {adjustment.loadError}
                  <Button variant="outline" onClick={adjustment.refresh}>
                    Retry balance
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <Button
              variant="outline"
              disabled={!adjustment.account || busy}
              onClick={editor.edit}
            >
              Edit account
            </Button>
            <FinanceAccountHistory
              accountId={account.id}
              onHistory={() => onHistory(account.id)}
              onInspect={onInspectTransaction}
            />
            <div className={financeDrawerFooter}>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
            <FieldGroup className="gap-6">
              <Field>
                <FieldLabel htmlFor="finance-name">Account name</FieldLabel>
                <Input
                  id="finance-name"
                  required
                  maxLength={120}
                  value={editor.name}
                  disabled={busy}
                  onChange={(event) => editor.setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="finance-kind">Account type</FieldLabel>
                <NativeSelect
                  id="finance-kind"
                  className="w-full"
                  value={editor.kind}
                  disabled={!!account || busy}
                  onChange={(event) => {
                    if (
                      event.target.value === "money" ||
                      event.target.value === "asset"
                    )
                      editor.setKind(event.target.value);
                  }}
                >
                  <NativeSelectOption value="money">Debit</NativeSelectOption>
                  <NativeSelectOption value="asset">Asset</NativeSelectOption>
                </NativeSelect>
                <FieldDescription>
                  Assets track value separately from debit balances.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="finance-group">Group</FieldLabel>
                <Input
                  id="finance-group"
                  list="finance-account-groups"
                  placeholder="e.g. Savings"
                  maxLength={80}
                  value={editor.group}
                  disabled={busy}
                  onChange={(event) => editor.setGroup(event.target.value)}
                />
                <datalist id="finance-account-groups">
                  {[
                    ...new Set(
                      finance.allAccounts
                        .map((account) => account.account_group)
                        .filter(Boolean),
                    ),
                  ]
                    .sort()
                    .map((group) => (
                      <option key={group} value={group} />
                    ))}
                </datalist>
                <FieldDescription>Leave blank for Ungrouped.</FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="finance-included"
                  checked={editor.included}
                  disabled={busy}
                  onCheckedChange={editor.setIncluded}
                />
                <div>
                  <FieldLabel htmlFor="finance-included">
                    Include in total balance and summary
                  </FieldLabel>
                  <FieldDescription>
                    Changes account totals across devices. Activity, reports,
                    and recorded balances stay intact.
                  </FieldDescription>
                </div>
              </Field>
              {!asset && (
                <Field>
                  <FieldLabel htmlFor="finance-maintaining">Maintaining balance (PHP)</FieldLabel>
                  <MoneyInput
                    id="finance-maintaining"
                    inputMode="decimal"
                    required
                    pattern="\d{1,3}(,\d{3})*(\.\d{1,2})?"
                    value={editor.maintaining}
                    disabled={busy}
                    onValueChange={(value) => editor.setMaintaining(value)}
                  />
                  <FieldDescription>
                    Reserved money, separate from opening balance. Both portions make up the net balance.
                    Changing this amount changes the net balance by the same difference.
                  </FieldDescription>
                </Field>
              )}
              {!account ? (
                <Field>
                  <FieldLabel htmlFor="finance-opening">
                    Opening balance (PHP)
                  </FieldLabel>
                  <MoneyInput
                    id="finance-opening"
                    inputMode="decimal"
                    signed
                    required
                    pattern="-?\d{1,3}(,\d{3})*(\.\d{1,2})?"
                    value={editor.opening}
                    disabled={busy}
                    onValueChange={(value) => editor.setOpening(value)}
                  />
                  <FieldDescription>
                    {asset ? "The value before recorded activity." : "The available portion before recorded activity, excluding maintaining balance."}
                    Openings are fixed and do not count as income or spending.
                  </FieldDescription>
                </Field>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="finance-opening">
                      Opening balance (PHP)
                    </FieldLabel>
                    <Input
                      id="finance-opening"
                      value={decimalPHP(account.opening_balance_cents)}
                      disabled
                    />
                    <FieldDescription>
                      Fixed opening. Change the current balance below to record
                      a dated difference.
                    </FieldDescription>
                  </Field>
                  {!account.archived && (
                    <>
                      {adjustment.loadError ? (
                        <Alert>
                          <AlertDescription>
                            {adjustment.loadError}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={adjustment.refresh}
                            >
                              Retry balance
                            </Button>
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Field data-invalid={!!errors.actual_balance}>
                          <FieldLabel htmlFor="finance-current">
                            Current {asset ? "value" : "balance"} (PHP)
                          </FieldLabel>
                          <MoneyInput
                            id="finance-current"
                            inputMode="decimal"
                            signed
                            value={adjustment.actual}
                            placeholder={
                              adjustment.account
                                ? decimalPHP(adjustment.account.balance_cents)
                                : "Loading balance…"
                            }
                            disabled={busy || !adjustment.account}
                            onValueChange={(value) =>
                              adjustment.setActual(value)
                            }
                            aria-invalid={!!errors.actual_balance}
                            aria-describedby="finance-current-help finance-current-error"
                          />
                          <FieldDescription id="finance-current-help">
                            Leave blank to keep{" "}
                            {formatPHP(current?.balance_cents ?? 0)}. A change
                            records a dated{" "}
                            {asset ? "valuation" : "reconciliation"} without
                            income or spending.
                          </FieldDescription>
                          <FieldError id="finance-current-error">
                            {errors.actual_balance}
                          </FieldError>
                        </Field>
                      )}
                      {adjustment.actual.trim() && (
                        <>
                          <Field data-invalid={!!errors.transaction_date}>
                            <FieldLabel htmlFor="finance-adjustment-date">
                              Balance date
                            </FieldLabel>
                            <FinanceDateInput
                              id="finance-adjustment-date"
                              value={adjustment.date}
                              min="1000-01-01"
                              max="9999-12-31"
                              disabled={busy}
                              onChange={adjustment.setDate}
                              aria-invalid={!!errors.transaction_date}
                              aria-describedby="finance-date-error"
                            />
                            <FieldError id="finance-date-error">
                              {errors.transaction_date}
                            </FieldError>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="finance-adjustment-text">
                              Reason (optional)
                            </FieldLabel>
                            <Textarea
                              id="finance-adjustment-text"
                              maxLength={2000}
                              value={adjustment.text}
                              disabled={busy}
                              onChange={(event) =>
                                adjustment.setText(event.target.value)
                              }
                            />
                          </Field>
                          {adjustment.difference !== null && (
                            <p role="status" className="text-sm">
                              Difference to record:{" "}
                              <strong className="tabular-nums">
                                {formatPHP(adjustment.difference)}
                              </strong>
                            </p>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={adjustment.refresh}
                          >
                            Refresh balance
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </FieldGroup>
            {(editor.error || finance.saveError || activity.saveError) && (
              <Alert>
                <AlertDescription>
                  {editor.error}
                  {finance.saveError}
                  {activity.saveError}
                  {finance.saveError &&
                    " Close and reopen the account to refresh its settings before retrying."}
                </AlertDescription>
              </Alert>
            )}
            <div className={account ? "mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-5" : financeDrawerFooter}>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !editor.name.trim()}>
                {busy ? "Saving…" : account ? "Save changes" : "Create account"}
              </Button>
            </div>
            {account && (
              <section className="mb-4 flex flex-col gap-3 border-t border-border pt-4 sm:mb-6">
                <p className="text-xs text-muted-foreground">
                  Archiving hides the account from active lists. Its balance and
                  history are retained; use the summary option above to exclude
                  its displayed balance.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    if (await editor.archive()) onClose();
                  }}
                >
                  {account.archived ? "Restore account" : "Archive account"}
                </Button>
              </section>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
