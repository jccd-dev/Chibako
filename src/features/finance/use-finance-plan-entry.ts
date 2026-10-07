"use client";

import { useEffect, useState } from "react";
import type { ActivityPage, FinanceTransaction } from "./activity-types";
import type { FinancePlan } from "./planning-types";
import type { FinanceObligation } from "./obligation-types";
import type { FinancePlanningController } from "./use-finance-planning";
import type { FinanceActivityController } from "./use-finance-activity";
import { createPlanSchema, updatePlanSchema, postPlanSchema } from "./planning-types";
import { financeJson } from "./client-json";
import { decimalCents } from "./money";
import { decimalPHP, localCalendarDate } from "./presentation";

export function useFinancePlanEntry(plan: FinancePlan | null, activity: FinanceActivityController, planning: FinancePlanningController, obligation: FinanceObligation | null, onClose: () => void) {
  const linked = !!plan?.obligation_id;
  const [mode, setMode] = useState<"edit" | "post" | "match" | "cancel">("edit");
  const [type, setType] = useState<"income" | "expense">(plan?.type ?? "expense");
  const [amount, setAmount] = useState(plan ? decimalPHP(plan.amount_cents) : "");
  const [account, setAccount] = useState(plan?.account_id ?? "");
  const [dueDate, setDueDate] = useState(plan?.due_date ?? localCalendarDate());
  const [date, setDate] = useState(localCalendarDate);
  const [category, setCategory] = useState(plan?.category_id ?? "");
  const [subcategory, setSubcategory] = useState(plan?.subcategory_id ?? "");
  const [text, setText] = useState(plan?.text ?? "");
  const [association, setAssociation] = useState(plan?.obligation_id ?? "");
  const [feeType, setFeeType] = useState<"income" | "expense">("expense");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeCategoryId, setFeeCategoryId] = useState("");
  const [feeSubcategoryId, setFeeSubcategoryId] = useState("");
  const [cashSource, setCashSource] = useState<"new" | "existing">("new");
  const [cashPick, setCashPick] = useState<FinanceTransaction | null>(null);
  const [cashPage, setCashPage] = useState<ActivityPage | null>(null);
  const [cashOffset, setCashOffset] = useState(0);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashError, setCashError] = useState("");
  const [cashReload, setCashReload] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = !plan || plan.status === "pending";
  const categories = activity.classifications.filter(row => row.kind === "category" && row.type === type && !row.parent_id && (!row.archived || row.id === category));
  const subcategories = activity.classifications.filter(row => row.parent_id === category && (!row.archived || row.id === subcategory));
  const feeCategories = activity.classifications.filter(row => row.kind === "category" && row.type === feeType && !row.parent_id && (!row.archived || row.id === feeCategoryId));
  const feeSubcategories = activity.classifications.filter(row => row.parent_id === feeCategoryId && (!row.archived || row.id === feeSubcategoryId));
  const accounts = activity.accounts.filter(row => row.kind === "money" && (!row.archived || (mode !== "post" && row.id === account) || row.id === cashPick?.account_id));

  const planType = plan?.type;
  useEffect(() => {
    if (!planType || !linked || mode !== "post" || cashSource !== "existing") return;
    const abort = new AbortController();
    setCashLoading(true); setCashError(""); setCashPage(null);
    const params = new URLSearchParams({ type: planType, payment_matchable: "true", hidden: "false", include_details: "true", limit: "25", offset: String(cashOffset) });
    void fetch(`/api/finance/activity?${params}`, { signal: abort.signal }).then(financeJson<ActivityPage>)
      .then(result => { if (!abort.signal.aborted) setCashPage(result); })
      .catch(e => { if (!abort.signal.aborted) setCashError(e instanceof Error ? e.message : "Could not load payment activity."); })
      .finally(() => { if (!abort.signal.aborted) setCashLoading(false); });
    return () => abort.abort();
  }, [linked, mode, cashSource, cashOffset, cashReload, planType]);

  async function submit(another: boolean) {
    if (linked && mode === "post" && (!obligation || cashSource === "existing" && !cashPick)) return;
    const fields = { type, amount, account_id: account, due_date: dueDate, category_id: category || null, subcategory_id: subcategory || null, text, tag_ids: plan?.tag_ids ?? [], ...(plan?.schedule_id ? { obligation_id: association || null } : {}) };
    const cash = cashSource === "existing" && cashPick ? { cash_activity_id: cashPick.id, cash_activity_version: cashPick.version } : {};
    const fee = linked && mode === "post" && cashSource === "new" && feeAmount ? { fee: { type: feeType, amount: feeAmount, category_id: feeCategoryId || null, subcategory_id: feeSubcategoryId || null } } : {};
    const actual = { version: plan?.version ?? 1, account_id: account, amount, transaction_date: date, ...(linked ? { obligation_version: obligation?.version } : {}), ...cash, ...fee };
    const validation = mode === "post" ? postPlanSchema.safeParse({ request_id: "validate", ...actual }) : plan ? updatePlanSchema.safeParse({ request_id: "validate", ...fields, version: plan.version }) : createPlanSchema.safeParse({ request_id: "validate", ...fields });
    const issues: Record<string, string> = {};
    if (!validation.success) for (const issue of validation.error.issues) issues[String(issue.path[0] ?? "amount")] = issue.message;
    try { if (decimalCents(amount) <= 0) issues.amount = "Enter a positive PHP amount."; } catch { issues.amount = "Enter a valid amount within the exact PHP range."; }
    if ("fee" in fee) {
      try { if (decimalCents(feeAmount) <= 0) issues.fee = "Enter a positive interest/fee amount."; }
      catch { issues.fee = "Enter a valid interest/fee amount within the exact PHP range."; }
    }
    setErrors(issues);
    if (Object.keys(issues).length) { document.getElementById(`plan-${Object.keys(issues)[0] === "fee" ? "fee-amount" : Object.keys(issues)[0]}`)?.focus(); return; }
    const result = await planning.save(plan?.id ?? null, mode === "post" ? "post" : plan ? "edit" : "create", mode === "post" ? actual : plan ? { ...fields, version: plan.version } : fields);
    if (!result) return;
    if (another && !plan) { setAmount(""); setText(""); requestAnimationFrame(() => document.getElementById("plan-amount")?.focus()); }
    else onClose();
  }
  function changeMode(value: typeof mode) { planning.resetSave(); setErrors({}); setMode(value); setAmount(plan ? decimalPHP(plan.amount_cents) : ""); setAccount(plan?.account_id ?? ""); setFeeAmount(""); setFeeCategoryId(""); setFeeSubcategoryId(""); setFeeType("expense"); setCashSource("new"); setCashPick(null); setCashPage(null); setCashError(""); setCashOffset(0); }
  function changeType(value: string) { setType(value === "income" ? "income" : "expense"); setCategory(""); setSubcategory(""); setAssociation(""); }
  function changeCategory(value: string) { setCategory(value); setSubcategory(""); }
  function changeFeeType(value: string) { setFeeType(value === "income" ? "income" : "expense"); setFeeCategoryId(""); setFeeSubcategoryId(""); }
  function changeFeeCategory(value: string) { setFeeCategoryId(value); setFeeSubcategoryId(""); }
  function chooseCashSource(value: string) { setCashSource(value === "existing" ? "existing" : "new"); clearCash(); setCashOffset(0); }
  function selectCash(record: FinanceTransaction) { setCashPick(record); setErrors({}); setAmount(decimalPHP(record.amount_cents)); setAccount(record.account_id); setDate(record.transaction_date); setFeeAmount(""); }
  function clearCash() { setCashPick(null); setErrors({}); setAmount(plan ? decimalPHP(plan.amount_cents) : ""); setAccount(plan?.account_id ?? ""); setDate(localCalendarDate()); setCashReload(n => n + 1); }
  function invalid(key: string) { return { "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `plan-error-${key}` : undefined }; }
  return { mode, type, amount, setAmount, account, setAccount, dueDate, setDueDate, date, setDate, category, subcategory, setSubcategory, text, setText, association, setAssociation, feeType, changeFeeType, feeAmount, setFeeAmount, feeCategoryId, changeFeeCategory, feeSubcategoryId, setFeeSubcategoryId, feeCategories, feeSubcategories, cashSource, chooseCashSource, cashPick, selectCash, clearCash, cashPage, cashOffset, setCashOffset, cashLoading, cashError, retryCash: () => setCashReload(value => value + 1), errors, editable, categories, subcategories, accounts, submit, changeMode, changeType, changeCategory, invalid };
}
