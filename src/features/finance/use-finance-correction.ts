"use client";

import { useEffect, useState } from "react";
import { postTransactionSchema, type FinanceTransaction } from "./activity-types";
import { activityActionSchema, correctActivitySchema, recordRefundSchema } from "./correction-types";
import { localCalendarDate } from "./presentation";
import type { FinanceActivityController } from "./use-finance-activity";

export const financeDecimal = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
type Action = "edit" | "hide" | "revert" | "refund";
export function useFinanceCorrection(record: FinanceTransaction, activity: FinanceActivityController, onSaved: (id: string) => void) {
  const [mode, setMode] = useState<"edit" | "refund">("edit");
  const [amount, setAmount] = useState(financeDecimal(record.amount_cents));
  const [accountId, setAccountId] = useState(record.account_id);
  const [destinationId, setDestinationId] = useState(record.destination_account_id ?? "");
  const [date, setDate] = useState(record.transaction_date);
  const [categoryId, setCategoryId] = useState(record.category_id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(record.subcategory_id ?? "");
  const [text, setText] = useState(record.text ?? "");
  const [tagIds, setTagIds] = useState(record.tag_ids ?? []);
  const [fee, setFee] = useState<FinanceTransaction | null>(null);
  const [feeError, setFeeError] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeCategoryId, setFeeCategoryId] = useState("");
  const [feeSubcategoryId, setFeeSubcategoryId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{ action: Exclude<Action, "edit">; input: object } | null>(null);
  const [feeLoad, setFeeLoad] = useState(0);
  useEffect(() => {
    let live = true;
    if (record.fee_transaction_id) {
      setFeeError("");
      void activity.inspect(record.fee_transaction_id).then(result => {
        if (!live) return;
        setFee(result); setFeeAmount(financeDecimal(result.amount_cents));
        setFeeCategoryId(result.category_id ?? ""); setFeeSubcategoryId(result.subcategory_id ?? "");
      }).catch(error => { if (live) setFeeError(error instanceof Error ? error.message : "Could not load linked fee."); });
    }
    return () => { live = false; };
  }, [record.fee_transaction_id, feeLoad]); // Inspection is an explicit read; unrelated option refreshes must not reset drafts.

  function startRefund() {
    activity.resetSave(); setErrors({}); setMode("refund");
    setAmount(financeDecimal(record.amount_cents - record.refunded_cents));
    setAccountId(record.account_id); setDate(localCalendarDate()); setText("");
  }
  function validate(action: Action): object | null {
    let input: object = { version: record.version, ...(record.obligation_id ? { obligation_version: record.obligation_version } : {}) };
    if (action === "refund") input = { ...input, amount, account_id: accountId, transaction_date: date, text };
    if (action === "edit") {
      const patch: Record<string, unknown> = {};
      if (amount !== financeDecimal(record.amount_cents)) patch.amount = amount;
      if (accountId !== record.account_id) patch.account_id = accountId;
      if (date !== record.transaction_date) patch.transaction_date = date;
      if (text !== (record.text ?? "")) patch.text = text;
      if (JSON.stringify(tagIds) !== JSON.stringify(record.tag_ids ?? [])) patch.tag_ids = tagIds;
      if (record.type === "transfer" && destinationId !== record.destination_account_id) patch.destination_account_id = destinationId;
      if (record.type === "income" || record.type === "expense") {
        if ((categoryId || null) !== record.category_id) patch.category_id = categoryId || null;
        if ((subcategoryId || null) !== record.subcategory_id) patch.subcategory_id = subcategoryId || null;
      }
      if (fee && (feeAmount !== financeDecimal(fee.amount_cents) || (feeCategoryId || null) !== fee.category_id || (feeSubcategoryId || null) !== fee.subcategory_id || patch.account_id || patch.transaction_date)) {
        patch.fee = { version: fee.version, amount: feeAmount, category_id: feeCategoryId || null, subcategory_id: feeSubcategoryId || null };
      }
      input = { ...input, ...patch };
    }
    const schema = action === "edit" ? correctActivitySchema : action === "refund" ? recordRefundSchema : activityActionSchema;
    const parsed = schema.safeParse({ ...input, request_id: "validation" });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] = issue.message;
      setErrors(next);
      return null;
    }
    if (action === "refund" || action === "edit" && record.type !== "reconciliation" && record.type !== "valuation") {
      const positive = postTransactionSchema.shape.amount.safeParse(amount);
      if (!positive.success || Number(amount) <= 0) {
        setErrors({ amount: "Use a positive PHP amount with at most two decimal places." }); return null;
      }
    }
    setErrors({});
    return input;
  }
  async function execute(action: Action, input: object) {
    const result = await activity.correct(record.id, action, input);
    if (result) onSaved(action === "refund" ? result.transaction.id : record.id);
  }
  async function submit() {
    const action = mode === "refund" ? "refund" : "edit";
    const input = validate(action);
    if (!input) return;
    if (action === "refund") setConfirmation({ action, input });
    else await execute(action, input);
  }
  function confirmAction(action: "hide" | "revert") {
    const input = validate(action);
    if (input) setConfirmation({ action, input });
  }
  return { mode, amount, setAmount, accountId, setAccountId, destinationId, setDestinationId, date, setDate, categoryId, setCategoryId, subcategoryId, setSubcategoryId, text, setText, tagIds, setTagIds,
    fee, feeError, feeAmount, setFeeAmount, feeCategoryId, setFeeCategoryId, feeSubcategoryId, setFeeSubcategoryId, retryFee: () => setFeeLoad(value => value + 1),
    errors, confirmation, setConfirmation, startRefund, submit, confirmAction, execute };
}
