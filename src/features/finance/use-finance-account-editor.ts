"use client";

import { useEffect, useRef, useState } from "react";
import type { FinanceAccount } from "./types";
import { accountGroupSchema, createAccountSchema } from "./types";
import type { FinanceAccountsController } from "./use-finance-accounts";
import type { FinanceActivityController } from "./use-finance-activity";
import { useFinanceAdjustment } from "./use-finance-adjustment";
import { decimalPHP } from "./presentation";
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
  const [opening, setOpening] = useState("0.00");
  const [maintaining, setMaintaining] = useState(decimalPHP(initial?.maintaining_balance_cents ?? 0));
  const [group, setGroup] = useState(initial?.account_group ?? "");
  const [included, setIncluded] = useState(initial?.include_in_summary ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const adjustment = useFinanceAdjustment(activity, account?.id ?? null, kind === "money" ? maintaining : undefined);
  useEffect(() => {
    if (adjustment.account) {
      setAccount(adjustment.account);
      if (!editing) {
        setName(adjustment.account.name);
        setGroup(adjustment.account.account_group);
        setIncluded(adjustment.account.include_in_summary);
        setMaintaining(decimalPHP(adjustment.account.maintaining_balance_cents));
      }
    }
  }, [adjustment.account, editing]);
  const busy = saving || finance.busy || activity.busy;

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
        maintainingCents !== account.maintaining_balance_cents
      ) {
        const saved = await finance.save(
          account?.id ?? null,
          account
            ? {
                name: parsedName.data,
                account_group: parsedGroup.data,
                include_in_summary: included,
                maintaining_balance: parsedMaintaining.data,
                version: account.version,
              }
            : {
                name: parsedName.data,
                kind,
                account_group: parsedGroup.data,
                include_in_summary: included,
                currency: "PHP",
                opening_balance: opening,
                maintaining_balance: parsedMaintaining.data,
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
    error,
    busy,
    adjustment,
    edit,
    save,
    archive,
  };
}
