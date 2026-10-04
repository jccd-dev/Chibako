"use client";

import { useState } from "react";
import type { FinancePlan } from "./planning-types";
import type { FinancePlanningController } from "./use-finance-planning";
import type { FinanceActivityController } from "./use-finance-activity";
import { createPlanSchema, updatePlanSchema, postPlanSchema } from "./planning-types";
import { decimalCents } from "./money";
import { decimalPHP, localCalendarDate } from "./presentation";

export function useFinancePlanEntry(plan: FinancePlan | null, activity: FinanceActivityController, planning: FinancePlanningController, onClose: () => void) {
  const [mode, setMode] = useState<"edit" | "post" | "match" | "cancel">("edit");
  const [type, setType] = useState<"income" | "expense">(plan?.type ?? "expense");
  const [amount, setAmount] = useState(plan ? decimalPHP(plan.amount_cents) : "");
  const [account, setAccount] = useState(plan?.account_id ?? "");
  const [dueDate, setDueDate] = useState(plan?.due_date ?? localCalendarDate());
  const [date, setDate] = useState(localCalendarDate);
  const [category, setCategory] = useState(plan?.category_id ?? "");
  const [subcategory, setSubcategory] = useState(plan?.subcategory_id ?? "");
  const [text, setText] = useState(plan?.text ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = !plan || plan.status === "pending";
  const categories = activity.classifications.filter(row => row.kind === "category" && row.type === type && !row.parent_id && (!row.archived || row.id === category));
  const subcategories = activity.classifications.filter(row => row.parent_id === category && (!row.archived || row.id === subcategory));
  const accounts = activity.accounts.filter(row => row.kind === "money" && (!row.archived || (mode !== "post" && row.id === account)));
  async function submit(another: boolean) {
    const fields = { type, amount, account_id: account, due_date: dueDate, category_id: category || null, subcategory_id: subcategory || null, text, tag_ids: plan?.tag_ids ?? [] };
    const actual = { version: plan?.version ?? 1, account_id: account, amount, transaction_date: date };
    const validation = mode === "post" ? postPlanSchema.safeParse({ request_id: "validate", ...actual }) : plan ? updatePlanSchema.safeParse({ request_id: "validate", ...fields, version: plan.version }) : createPlanSchema.safeParse({ request_id: "validate", ...fields });
    const issues: Record<string, string> = {};
    if (!validation.success) for (const issue of validation.error.issues) issues[String(issue.path[0] ?? "amount")] = issue.message;
    try { if (decimalCents(amount) <= 0) issues.amount = "Enter a positive PHP amount."; } catch { issues.amount = "Enter a valid amount within the exact PHP range."; }
    setErrors(issues);
    if (Object.keys(issues).length) { document.getElementById(`plan-${Object.keys(issues)[0]}`)?.focus(); return; }
    const result = await planning.save(plan?.id ?? null, mode === "post" ? "post" : plan ? "edit" : "create", mode === "post" ? actual : plan ? { ...fields, version: plan.version } : fields);
    if (!result) return;
    if (another && !plan) { setAmount(""); setText(""); requestAnimationFrame(() => document.getElementById("plan-amount")?.focus()); }
    else onClose();
  }
  function changeMode(value: typeof mode) { planning.resetSave(); setErrors({}); setMode(value); setAmount(plan ? decimalPHP(plan.amount_cents) : ""); setAccount(plan?.account_id ?? ""); }
  function changeType(value: string) { setType(value === "income" ? "income" : "expense"); setCategory(""); setSubcategory(""); }
  function changeCategory(value: string) { setCategory(value); setSubcategory(""); }
  function invalid(key: string) { return { "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `plan-error-${key}` : undefined }; }
  return { mode, type, amount, setAmount, account, setAccount, dueDate, setDueDate, date, setDate, category, subcategory, setSubcategory, text, setText, errors, editable, categories, subcategories, accounts, submit, changeMode, changeType, changeCategory, invalid };
}
