"use client";

import { useRef, useState } from "react";
import type { FinanceAccount } from "./types";
import { creditSettingsError, type CreditSettings } from "./account-policy";
import { accountGroupSchema, createAccountSchema } from "./types";
import type { FinanceAccountsController } from "./use-finance-accounts";
import type { FinanceActivityController } from "./use-finance-activity";
import { useFinanceAdjustment } from "./use-finance-adjustment";
import { decimalPHP, decimalPHPInput } from "./presentation";
import { decimalCents } from "./money";

export function useFinanceAccountEditor(
  selected: "create" | FinanceAccount,
  finance: FinanceAccountsController,
  activity: FinanceActivityController,
) {
  const initial = selected === "create" ? null : selected;
  const [account, setAccount] = useState(initial);
  const [editing, setEditing] = useState(!initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "money");
  const [opening, setOpening] = useState("0");
  const [maintaining, setMaintaining] = useState(decimalPHPInput(initial?.maintaining_balance_cents ?? 0));
  const [group, setGroup] = useState(initial?.account_group ?? "");
  const [included, setIncluded] = useState(initial?.include_in_summary ?? true);
  const [creditLimit, setCreditLimit] = useState(initial?.credit_limit_cents ? decimalPHPInput(initial.credit_limit_cents) : "");
  const [hasOwed, setHasOwed] = useState(false);
  const [owed, setOwed] = useState("");
  const [statementDay, setStatementDay] = useState(initial?.statement_day ? String(initial.statement_day) : "");
  const [dueMode, setDueMode] = useState<"fixed_day" | "after_statement">(initial?.due_mode ?? "fixed_day");
  const [dueValue, setDueValue] = useState(initial?.due_value ? String(initial.due_value) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const adjustment = useFinanceAdjustment(activity, account?.id ?? null, kind === "money" ? maintaining : undefined);
  const [syncedAdjustment, setSyncedAdjustment] = useState({ account: adjustment.account, editing });
  if (adjustment.account && (adjustment.account !== syncedAdjustment.account || editing !== syncedAdjustment.editing)) {
    setSyncedAdjustment({ account: adjustment.account, editing });
    setAccount(adjustment.account);
    if (!editing) {
      setName(adjustment.account.name);
      setGroup(adjustment.account.account_group);
      setIncluded(adjustment.account.include_in_summary);
      setMaintaining(decimalPHPInput(adjustment.account.maintaining_balance_cents));
      setCreditLimit(adjustment.account.credit_limit_cents ? decimalPHPInput(adjustment.account.credit_limit_cents) : "");
      setStatementDay(adjustment.account.statement_day ? String(adjustment.account.statement_day) : "");
      setDueMode(adjustment.account.due_mode ?? "fixed_day");
      setDueValue(adjustment.account.due_value ? String(adjustment.account.due_value) : "");
    }
  }
  const busy = saving || finance.busy || activity.busy;
  const credit = parseCredit();

  function parseCredit(): { error: string; settings?: CreditSettings; owedCents?: number } {
    if (kind !== "credit") return { error: "" };
    const amount = createAccountSchema.shape.maintaining_balance;
    let limit: number | null = null, owedCents = 0;
    try {
      if (creditLimit.trim()) limit = decimalCents(amount.parse(creditLimit));
      if (hasOwed && owed.trim()) owedCents = decimalCents(amount.parse(owed));
    } catch {
      return { error: "Enter amounts as non-negative PHP with at most two decimal places" };
    }
    const settings: CreditSettings = {
      credit_limit_cents: limit,
      statement_day: statementDay ? Number(statementDay) : null,
      due_mode: dueValue ? dueMode : null,
      due_value: dueValue ? Number(dueValue) : null,
    };
    return { error: creditSettingsError("credit", settings) ?? "", settings, owedCents };
  }

  function edit() {
    finance.resetSave();
    activity.resetSave();
    setError("");
    adjustment.setActual("");
    setEditing(true);
  }

  async function save() {
    if (saveLock.current) return false;
    setError("");
    const parsedGroup = accountGroupSchema.safeParse(group);
    const parsedName = createAccountSchema.shape.name.safeParse(name);
    if (!parsedGroup.success || !parsedName.success) {
      setError(
        "Enter an account name up to 120 characters and a group up to 80 characters.",
      );
      return false;
    }
    const parsedMaintaining = createAccountSchema.shape.maintaining_balance.safeParse(kind === "money" ? maintaining : "0");
    if (!parsedMaintaining.success) {
      setError("Enter a non-negative maintaining balance with at most two decimal places.");
      return false;
    }
    let maintainingCents: number;
    try { maintainingCents = decimalCents(parsedMaintaining.data); }
    catch { setError("Maintaining balance exceeds the exact-cent range."); return false; }
    if (credit.error) {
      setError(`${credit.error}.`);
      return false;
    }
    const settings = credit.settings;
    const creditFields: Record<string, string | number | null> = settings
      ? { credit_limit: decimalPHP(settings.credit_limit_cents ?? 0), statement_day: settings.statement_day, due_mode: settings.due_mode, due_value: settings.due_value }
      : {};
    const creditChanged = !!account && !!settings && (["credit_limit_cents", "statement_day", "due_mode", "due_value"] as const).some(key => settings[key] !== account[key]);
    const owedCents = credit.owedCents ?? 0;
    const adjust = !!account && !!adjustment.actual.trim();
    if (adjust && !adjustment.validate()) return false;
    saveLock.current = true;
    setSaving(true);
    try {
      let savedAccount = account;
      if (
        !account ||
        parsedName.data !== account.name ||
        parsedGroup.data !== account.account_group ||
        included !== account.include_in_summary ||
        maintainingCents !== account.maintaining_balance_cents ||
        creditChanged
      ) {
        const saved = await finance.save(
          account?.id ?? null,
          account
            ? {
                name: parsedName.data,
                account_group: parsedGroup.data,
                include_in_summary: included,
                maintaining_balance: parsedMaintaining.data,
                ...(creditChanged ? creditFields : {}),
                version: account.version,
              }
            : {
                name: parsedName.data,
                kind,
                account_group: parsedGroup.data,
                include_in_summary: included,
                currency: "PHP",
                // An existing owed balance on a card is a negative opening balance.
                opening_balance: kind === "credit" ? (owedCents ? `-${decimalPHP(owedCents)}` : "0") : opening,
                maintaining_balance: parsedMaintaining.data,
                // Create takes omitted, not null, optional credit settings.
                ...Object.fromEntries(Object.entries(creditFields).filter(([, value]) => value !== null)),
              },
          account ? "Account details saved." : "Account created.",
        );
        if (!saved) return false;
        savedAccount = saved;
        setAccount(saved);
      }
      if (!savedAccount) return false;
      if (adjust && adjustment.account) {
        if (decimalCents(adjustment.actual) === adjustment.expectedBalance) return true;
        if (!(await adjustment.save())) {
          setError(
            "Account details are saved. The balance adjustment was not confirmed. Retry safely, or refresh the balance before comparing again.",
          );
          return false;
        }
        adjustment.setActual("");
      }
      return true;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function archive() {
    if (!account || busy) return false;
    return !!(await finance.save(
      account.id,
      { version: account.version, archived: !account.archived },
      account.archived
        ? "Account restored."
        : "Account archived. Its balance and history are retained.",
    ));
  }

  return {
    account,
    editing,
    name,
    setName,
    kind,
    setKind,
    opening,
    setOpening,
    maintaining,
    setMaintaining,
    group,
    setGroup,
    included,
    setIncluded,
    creditLimit,
    setCreditLimit,
    hasOwed,
    setHasOwed,
    owed,
    setOwed,
    statementDay,
    setStatementDay,
    dueMode,
    setDueMode,
    dueValue,
    setDueValue,
    creditPreview: credit.settings
      ? { used_cents: credit.owedCents ?? 0, available_cents: Math.max(0, (credit.settings.credit_limit_cents ?? 0) - (credit.owedCents ?? 0)) }
      : null,
    error,
    busy,
    adjustment,
    edit,
    save,
    archive,
  };
}
