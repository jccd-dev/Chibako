"use client";

import { useEffect, useState, type FormEvent } from "react";
import { IconPlus } from "@tabler/icons-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "cn";
import { GoalProgressGauge } from "./GoalProgressGauge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "./MoneyInput";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FinanceGoal, FinanceGoalAllocation } from "@/features/finance/goal-types";
import {
  useFinanceGoals,
  type FinanceGoalsController,
} from "@/features/finance/use-finance-goals";
import {
  financeDrawerFooter,
  financeSheet,
  formatPHP,
  localCalendarDate,
} from "@/features/finance/presentation";

export function FinanceGoals({
  focusAccountId,
  onFocusHandled,
}: {
  focusAccountId?: string | null;
  onFocusHandled?: () => void;
} = {}) {
  const goals = useFinanceGoals();
  const { page, openEdit, openForAccount } = goals;
  useEffect(() => {
    if (!focusAccountId || !page) return;
    const goal = page.goals.find((row) =>
      row.linked_account_id === focusAccountId
      || row.allocations.some((allocation) => allocation.account_id === focusAccountId),
    );
    if (goal) {
      void openEdit(goal);
      onFocusHandled?.();
      return;
    }
    void openForAccount(focusAccountId).finally(() => onFocusHandled?.());
  }, [focusAccountId, page, onFocusHandled, openEdit, openForAccount]);
  return (
    <Card id="finance-goals" size="sm">
      <CardHeader>
        <CardTitle>Savings goals</CardTitle>
        <CardDescription>
          Save by moving real cash into your goals. Goal money movements do not
          appear as expenses in history.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add savings goal"
            onClick={goals.openCreate}
          >
            <IconPlus aria-hidden="true" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <label className="mb-4 flex min-h-7 items-center gap-2 text-xs">
          <Checkbox
            checked={goals.archived}
            onCheckedChange={checked => goals.changeArchived(checked)}
          />
          View archived goals
        </label>
        {goals.loadError ? (
          <Alert>
            <AlertDescription>
              {goals.loadError}
              <Button
                variant="outline"
                onClick={() => void goals.refresh()}
              >
                Retry goals
              </Button>
            </AlertDescription>
          </Alert>
        ) : goals.loading ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            Loading goals…
          </p>
        ) : !goals.page?.goals.length ? (
          <Empty className="px-0 py-4">
            <EmptyHeader>
              <EmptyTitle>
                No {goals.archived ? "archived " : ""}goals
              </EmptyTitle>
              <EmptyDescription>
                Create a goal, then use Add money to move cash into it.
              </EmptyDescription>
            </EmptyHeader>
            {!goals.archived && (
              <Button
                variant="outline"
                onClick={goals.openCreate}
              >
                Add goal
              </Button>
            )}
          </Empty>
        ) : (
          <>
            {goals.page.goals.length > 1 && (
              <dl className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <div className="whitespace-nowrap">
                  <dt className="inline text-muted-foreground">Total saved&nbsp;</dt>
                  <dd className="inline font-semibold tabular-nums">
                    {formatPHP(
                      goals.page.goals.reduce(
                        (sum, goal) => sum + goal.saved_cents,
                        0,
                      ),
                    )}
                  </dd>
                </div>
                <div className="whitespace-nowrap">
                  <dt className="inline text-muted-foreground">Combined targets&nbsp;</dt>
                  <dd className="inline font-semibold tabular-nums">
                    {formatPHP(
                      goals.page.goals.reduce(
                        (sum, goal) => sum + goal.target_cents,
                        0,
                      ),
                    )}
                  </dd>
                </div>
              </dl>
            )}
            <ul className="flex flex-col divide-y divide-border/60">
              {goals.page.goals.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  onOpen={() => void goals.openEdit(goal)}
                />
              ))}
            </ul>
          </>
        )}
        {goals.page && goals.page.total > 25 && (
          <nav
            aria-label="Goal pages"
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            <Button
              variant="outline"
              disabled={!goals.offset || goals.loading}
              onClick={() => goals.setOffset(Math.max(0, goals.offset - 25))}
            >
              Previous goals
            </Button>
            <span>
              {goals.offset + 1}–{Math.min(goals.offset + 25, goals.page.total)}{" "}
              of {goals.page.total}
            </span>
            <Button
              variant="outline"
              disabled={goals.offset + 25 >= goals.page.total || goals.loading}
              onClick={() => goals.setOffset(goals.offset + 25)}
            >
              Next goals
            </Button>
          </nav>
        )}
      </CardContent>
      <Sheet
        open={goals.panel !== null}
        onOpenChange={(open) => {
          if (!open && !goals.busy) goals.closePanel();
        }}
      >
        <SheetContent className={`${financeSheet} overscroll-contain`} showCloseButton={false}>
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle>
              {goals.panel === "create"
                ? "Add goal"
                : goals.editing?.archived
                  ? "Archived goal"
                  : "Edit goal"}
            </SheetTitle>
            <SheetDescription>
              Deposits and withdrawals move real cash in or out of the goal.
              Goal movements do not appear as expenses in history.
            </SheetDescription>
          </SheetHeader>
          <GoalPanel key={goals.panel ?? "closed"} goals={goals} />
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function GoalRow({ goal, onOpen }: { goal: FinanceGoal; onOpen: () => void }) {
  const percent = Math.min(
    100,
    Math.round((goal.saved_cents / goal.target_cents) * 100),
  );
  const overdue =
    !goal.achieved &&
    !goal.archived &&
    !!goal.due_date &&
    goal.due_date < localCalendarDate();
  const status = goal.archived
    ? "Archived"
    : goal.achieved
      ? "Achieved"
      : "Saving";
  const holding = goal.linked_account_name
    ? `Held in ${goal.linked_account_name}`
    : "Held in the goal";
  return (
    <li>
      <button
        type="button"
        title={`${goal.name}: ${formatPHP(goal.saved_cents)} of ${formatPHP(goal.target_cents)} (${percent}%) · ${status} · ${holding}${goal.due_date ? ` · Due ${goal.due_date}` : ""}${overdue ? " · Overdue" : ""}`}
        className="flex min-h-11 w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${goal.archived ? "View" : "Edit"} goal ${goal.name}: ${formatPHP(goal.saved_cents)} of ${formatPHP(goal.target_cents)}`}
        onClick={onOpen}
      >
        <GoalProgressGauge
          percent={percent}
          label={`${goal.name} progress`}
          className={cn("size-9 flex-none", goal.archived && "opacity-40")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{goal.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            of {formatPHP(goal.target_cents)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-xs font-medium tabular-nums">
            {formatPHP(goal.saved_cents)}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-xs",
              overdue
                ? "text-destructive"
                : goal.achieved && !goal.archived
                  ? "text-primary"
                  : "text-muted-foreground",
            )}
          >
            {status}
          </span>
        </span>
      </button>
    </li>
  );
}

function GoalPanel({ goals }: { goals: FinanceGoalsController }) {
  const goal = goals.editing,
    readOnly = !!goal?.archived,
    disabled = goals.busy || goals.inspecting;
  const funding = goal?.allocations ?? [];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void goals.save();
  }
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
      {goals.inspecting && <p role="status">Loading goal…</p>}
      {goals.saveError && (
        <Alert>
          <AlertDescription>
            {goals.saveError} Retry safely, or close and reopen the goal to
            refresh its version.
          </AlertDescription>
        </Alert>
      )}
      {goals.notice && <p role="status">{goals.notice}</p>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <FieldGroup className="gap-6">
          <Field>
            <FieldLabel htmlFor="goal-name">Name</FieldLabel>
            <Input
              id="goal-name"
              maxLength={120}
              value={goals.name}
              disabled={disabled || readOnly}
              onChange={(event) => goals.setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="goal-target">Target (PHP)</FieldLabel>
            <MoneyInput
              id="goal-target"
              inputMode="decimal"
              className="tabular-nums"
              placeholder="0.00"
              value={goals.target}
              disabled={disabled || readOnly}
              onValueChange={(value) => goals.setTarget(value)}
            />
            <FieldDescription>
              A positive amount with up to two decimal places.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="goal-due-date">Due date (optional)</FieldLabel>
            <Input
              id="goal-due-date"
              type="date"
              min="1000-01-01"
              max="9999-12-31"
              value={goals.dueDate}
              disabled={disabled || readOnly}
              onChange={(event) => goals.setDueDate(event.target.value)}
            />
          </Field>
          {!readOnly && (
            <Field>
              <FieldLabel htmlFor="goal-linked-account">
                Linked account (optional)
              </FieldLabel>
              <NativeSelect
                id="goal-linked-account"
                className="w-full"
                disabled={disabled}
                value={goals.linkedAccount}
                onChange={(event) => goals.selectLinkedAccount(event.target.value)}
              >
                <NativeSelectOption value="">None (held in the goal)</NativeSelectOption>
                {goals.accounts
                  .filter((row) => !row.archived || row.account_id === goal?.linked_account_id)
                  .map((row) => (
                    <NativeSelectOption key={row.account_id} value={row.account_id}>
                      {row.account_name}
                      {row.archived ? " (archived)" : ""}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <FieldDescription>
                {goal && goal.saved_cents > 0
                  ? `Changing this link moves the current ${formatPHP(goal.saved_cents)} saved balance to the new backing account. It does not add money.`
                  : !goal
                    ? "The linked account's existing positive balance becomes this goal's progress. Choose an account with no money reserved by another goal. Without a link, the goal holds its own money."
                    : "Money added to the goal is kept in this account. Without a link, the goal holds its own money."}
              </FieldDescription>
            </Field>
          )}
        </FieldGroup>
        {(goal || !readOnly) && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {goal && <GoalRemovalActions goal={goal} goals={goals} readOnly={readOnly} />}
              {!readOnly && (
                <Button type="submit" disabled={disabled}>
                  {goals.busy ? "Saving…" : goal ? "Save goal changes" : "Add goal"}
                </Button>
              )}
            </div>
            {goal && !readOnly && goal.saved_cents > 0 && (
              <p className="text-right text-xs text-muted-foreground">
                Withdraw the {formatPHP(goal.saved_cents)} still held before archiving.
              </p>
            )}
          </div>
        )}
      </form>
      {goal && !readOnly && (
        <MovementPanel goals={goals} disabled={disabled} />
      )}
      {goal && (
        <section
          aria-label="Goal funding breakdown"
          className="flex flex-col gap-3 border-t border-border pt-5"
        >
          <p className="font-medium">
            {formatPHP(goal.saved_cents)} of {formatPHP(goal.target_cents)}
            {goal.achieved && " · Achieved"}
          </p>
          <p className="text-xs text-muted-foreground">
            {readOnly
              ? "This goal is archived."
              : "Remaining contributions by funding account. Withdrawals reduce these amounts."}
          </p>
          {funding.length ? (
            <ul className="flex flex-col gap-3">
              {funding.map((row) => (
                <GoalAllocationRow key={row.account_id} row={row} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No money held in this goal.
            </p>
          )}
        </section>
      )}
      <div className={financeDrawerFooter}>
        <Button
          variant="outline"
          disabled={goals.busy}
          onClick={goals.closePanel}
        >
          {readOnly ? "Close" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

function MovementPanel({ goals, disabled }: { goals: FinanceGoalsController; disabled: boolean }) {
  const goal = goals.editing;
  if (!goal) return null;
  const deposit = goals.direction === "deposit";
  const linked = goal.linked_account_id;
  const linkedName = goal.linked_account_name ?? "the linked account";
  const selected = goals.accounts.find(
    (row) => row.account_id === goals.accountId,
  );
  const destinationName = selected?.account_name ?? "the chosen account";
  const options = goals.accounts
    .filter((row) => !row.archived)
    .filter((row) => row.account_id !== linked);
  const note = !goals.accountId
    ? deposit
      ? "Choose the account to move money out of."
      : "Choose the account the money moves into."
    : deposit
      ? linked
        ? `Move money out of ${destinationName} and into this goal. It will not appear as expenses in history. The money is added to ${linkedName}.`
        : `Move money out of ${destinationName} and into this goal. It will not appear as expenses in history. The goal holds the money.`
      : linked
        ? `Money is sent from the linked account ${linkedName} into ${destinationName}. It will not appear as expenses in history.`
        : `Money held in this goal moves into ${destinationName}. It will not appear as expenses in history.`;
  return (
    <section aria-label="Goal money" className="flex flex-col gap-4 border-t border-border pt-5">
      <p className="text-sm text-muted-foreground">
        {linked
          ? `This goal is held in the linked account ${linkedName}.`
          : "This goal holds its own money."}{" "}
        Use the movement below to move cash in or out.
      </p>
      <Field>
        <FieldLabel htmlFor="goal-direction">Action</FieldLabel>
        <NativeSelect
          id="goal-direction"
          className="w-full"
          disabled={disabled}
          value={goals.direction}
          onChange={(event) => goals.selectDirection(event.target.value as "deposit" | "withdrawal")}
        >
          <NativeSelectOption value="deposit">Add money</NativeSelectOption>
          <NativeSelectOption value="withdrawal">Withdraw</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="goal-movement-account">
          {deposit ? "Source account" : "Destination account"}
        </FieldLabel>
        <NativeSelect
          id="goal-movement-account"
          className="w-full"
          disabled={disabled}
          value={goals.accountId}
          onChange={(event) => goals.selectAccount(event.target.value)}
        >
          <NativeSelectOption value="">Choose an account</NativeSelectOption>
          {options.map((row) => (
            <NativeSelectOption key={row.account_id} value={row.account_id}>
              {row.account_name}
              {!deposit && row.account_id === linked ? " (linked account)" : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {selected && deposit && (
          <FieldDescription>
            {selected.account_name} holds {formatPHP(selected.balance_cents)}.
          </FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="goal-movement-amount">Amount (PHP)</FieldLabel>
        <MoneyInput
          id="goal-movement-amount"
          inputMode="decimal"
          className="tabular-nums"
          placeholder="0.00"
          disabled={disabled || !goals.accountId}
          value={goals.amount}
          onValueChange={(value) => goals.setAmount(value)}
        />
        <FieldDescription>{note}</FieldDescription>
        {!deposit && (
          <FieldDescription>Available to withdraw: {formatPHP(goal.saved_cents)}.</FieldDescription>
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          disabled={disabled || !goals.accountId}
          onClick={() => void goals.moveMoney()}
        >
          {goals.busy
            ? "Moving…"
            : deposit
              ? "Add money"
              : "Withdraw"}
        </Button>
      </div>
    </section>
  );
}

function GoalAllocationRow({ row }: { row: FinanceGoalAllocation }) {
  return (
    <li className="text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="break-words">{row.account_name}</span>
        <strong className="tabular-nums">
          {formatPHP(row.amount_cents)}
        </strong>
      </div>
    </li>
  );
}

function GoalRemovalActions({ goal, goals, readOnly }: { goal: FinanceGoal; goals: FinanceGoalsController; readOnly: boolean }) {
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const locked = goals.busy || goals.inspecting;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="mr-auto text-destructive hover:text-destructive"
        disabled={locked}
        onClick={() => setConfirm("delete")}
      >
        Delete
      </Button>
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          disabled={locked || goal.saved_cents > 0}
          onClick={() => setConfirm("archive")}
        >
          Archive
        </Button>
      )}
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={open => !open && setConfirm(null)}
        title={`Archive ${goal.name}?`}
        description="The goal becomes read-only and moves to archived goals. Its history is kept."
        confirmLabel="Archive goal"
        onConfirm={() => { setConfirm(null); void goals.archive(); }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={open => !open && setConfirm(null)}
        destructive
        title={`Delete ${goal.name} permanently?`}
        description="This removes the goal and its history for good and cannot be undone. If it moved money between accounts, return the money to where it came from first; Chibako refuses to delete while balances would change."
        confirmLabel="Delete permanently"
        onConfirm={() => { setConfirm(null); void goals.remove(); }}
      />
    </>
  );
}
