"use client";

import { useEffect, useRef, useState } from "react";
import { postTransactionSchema } from "./activity-types";
import { decimalCents } from "./money";
import { localCalendarDate } from "./presentation";
import type { FinanceActivityController } from "./use-finance-activity";

export function useFinanceEntry(activity: FinanceActivityController, open: boolean) {
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(localCalendarDate);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [text, setText] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      activity.resetSave(); setType("expense"); setAmount(""); setAccountId(""); setDate(localCalendarDate()); setCategoryId(""); setSubcategoryId(""); setText(""); setTagIds([]); setErrors({});
    }
    wasOpen.current = open;
  }, [open, activity]);

  function changeType(value: "expense" | "income") { setType(value); setCategoryId(""); setSubcategoryId(""); }
  function changeCategory(value: string) { setCategoryId(value); setSubcategoryId(""); }
  async function save(another: boolean): Promise<{ saved: boolean; invalidField?: string }> {
    const input = { type, amount, account_id: accountId, transaction_date: date, category_id: categoryId || null, subcategory_id: subcategoryId || null, text, tag_ids: tagIds };
    const parsed = postTransactionSchema.safeParse({ request_id: "validate", ...input });
    const validation: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) validation[String(issue.path[0])] = issue.message;
    if (!validation.amount) {
      try {
        if (decimalCents(amount) <= 0) validation.amount = "Enter a positive amount within the exact PHP range.";
      } catch { validation.amount = "Enter a positive amount within the exact PHP range."; }
    }
    setErrors(validation);
    const invalidField = Object.keys(validation)[0];
    if (invalidField) return { saved: false, invalidField };
    const result = await activity.post(input);
    if (!result) return { saved: false };
    if (another) { setAmount(""); setText(""); setTagIds([]); }
    return { saved: true };
  }

  return { type, changeType, amount, setAmount, accountId, setAccountId, date, setDate, categoryId, changeCategory, subcategoryId, setSubcategoryId, text, setText, tagIds, setTagIds, errors, save };
}
