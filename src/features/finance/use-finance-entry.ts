"use client";

import { useEffect, useRef, useState } from "react";
import { postTransactionSchema } from "./activity-types";
import { postTransferSchema } from "./movement-types";
import { decimalCents } from "./money";
import { localCalendarDate } from "./presentation";
import type { FinanceNoteChoice } from "./note-link-types";
import type { FinanceActivityController } from "./use-finance-activity";

export function useFinanceEntry(activity: FinanceActivityController, open: boolean) {
  const [type, setType] = useState<"expense" | "income" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [hasFee, setHasFee] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [feeCategoryId, setFeeCategoryId] = useState("");
  const [feeSubcategoryId, setFeeSubcategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(localCalendarDate);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [text, setText] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<FinanceNoteChoice[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      activity.resetSave(); setType("expense"); setAmount(""); setDestinationId(""); setHasFee(false); setFeeAmount(""); setFeeCategoryId(""); setFeeSubcategoryId(""); setAccountId(""); setDate(localCalendarDate()); setCategoryId(""); setSubcategoryId(""); setText(""); setTagIds([]); setNotes([]); setErrors({});
    }
    wasOpen.current = open;
  }, [open, activity]);

  function changeType(value: "expense" | "income" | "transfer") { setType(value); setCategoryId(""); setSubcategoryId(""); }
  function changeCategory(value: string) { setCategoryId(value); setSubcategoryId(""); }
  async function save(another: boolean): Promise<{ saved: boolean; invalidField?: string }> {
    const input = { type, amount, account_id: accountId, transaction_date: date, category_id: categoryId || null, subcategory_id: subcategoryId || null, text, tag_ids: tagIds, note_ids: notes.map(note => note.id) };
    const transfer = { source_account_id: accountId, destination_account_id: destinationId, amount, transaction_date: date, text, tag_ids: tagIds, note_ids: notes.map(note => note.id), ...(hasFee ? { fee: { amount: feeAmount, category_id: feeCategoryId, subcategory_id: feeSubcategoryId || null } } : {}) };
    const parsed = type === "transfer" ? postTransferSchema.safeParse({ request_id: "validate", ...transfer }) : postTransactionSchema.safeParse({ request_id: "validate", ...input });
    const validation: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) validation[issue.path.length ? issue.path.join("_") : "destination_account_id"] = issue.message;
    if (type === "transfer" && hasFee) {
      try { if (decimalCents(feeAmount) <= 0) validation.fee_amount = "Enter a positive PHP fee."; }
      catch { validation.fee_amount = "Enter a valid PHP fee within the exact-cent range."; }
    }
    if (!validation.amount) {
      try {
        if (decimalCents(amount) <= 0) validation.amount = "Enter a positive amount within the exact PHP range.";
      } catch { validation.amount = "Enter a positive amount within the exact PHP range."; }
    }
    setErrors(validation);
    const invalidField = Object.keys(validation)[0];
    if (invalidField) return { saved: false, invalidField };
    const result = type === "transfer" ? await activity.postMovement("transfers", transfer) : await activity.post(input);
    if (!result) return { saved: false };
    if (another) { setAmount(""); setFeeAmount(""); setText(""); setTagIds([]); setNotes([]); }
    return { saved: true };
  }

  return { destinationId, setDestinationId, hasFee, setHasFee, feeAmount, setFeeAmount, feeCategoryId, changeFeeCategory: (value: string) => { setFeeCategoryId(value); setFeeSubcategoryId(""); }, feeSubcategoryId, setFeeSubcategoryId, type, changeType, amount, setAmount, accountId, setAccountId, date, setDate, categoryId, changeCategory, subcategoryId, setSubcategoryId, text, setText, tagIds, setTagIds, notes, setNotes, errors, save };
}
