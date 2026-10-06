"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { useFinancePlanEntry } from "@/features/finance/use-finance-plan-entry";
import { financeJson } from "@/features/finance/client-json";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP as money, localCalendarDate } from "@/features/finance/presentation";
import { Button } from "./ui/button";
import { FinanceDateInput } from "./FinanceDateInputs";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { FinanceOptionStatus } from "./FinanceActivity";
import { FinancePlanMatch } from "./FinancePlanMatch";
import { FinanceObligations } from "./FinanceObligations";
import { FinanceRecurrence } from "./FinanceRecurrence";

export function FinancePlans({ planning, activity }: { planning: FinancePlanningController; activity: FinanceActivityController }) {
  const [panel, setPanel] = useState<string | null>(null);
  const [detail, setDetail] = useState<FinancePlan | null>(null);
  const [detailError, setDetailError] = useState("");
  const [reload, setReload] = useState(0);
  const [futureOccurrence, setFutureOccurrence] = useState<FinancePlan | null>(null);
  const [selected, setSelected] = useState<FinancePlan[]>([]);
  useEffect(() => { setSelected([]); }, [planning.page]);
  useEffect(() => {
    setDetail(null); setDetailError("");
    if (!panel || panel === "create") return;
    const abort = new AbortController();
    void fetch(`/api/finance/plans/${panel}?include_details=true`, { signal: abort.signal }).then(financeJson<{ plan: FinancePlan }>).then(result => { if (!abort.signal.aborted) setDetail(result.plan); })
      .catch(e => { if (!abort.signal.aborted) setDetailError(e instanceof Error ? e.message : "Could not inspect plan."); });
    return () => abort.abort();
  }, [panel, reload]);
  function open(id: string) { planning.resetSave(); setPanel(id); }
  const today = localCalendarDate();
  return <><FinanceRecurrence activity={activity} planning={planning} occurrence={futureOccurrence} onCloseOccurrence={() => setFutureOccurrence(null)} /><section aria-label="Planned activity and recurring occurrences" className="mt-8 border-t border-border pt-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Planned activity and occurrences</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Expected income and expenses stay pending until you confirm actual activity. Planning never changes balances or consumes budgets.</p></div><Button className={control} onClick={() => open("create")}>Add plan</Button></div>
    <div className="mt-4 flex flex-wrap gap-3"><Button variant="outline" className={control} disabled={planning.busy} onClick={() => void planning.save(null, "catch-up", {})}>{planning.busy ? "Preparing review…" : planning.hasMoreCatchUp ? "Load more missed occurrences" : "Refresh due occurrences"}</Button>{selected.length > 0 && <Button variant="outline" className={control} disabled={planning.busy} onClick={() => void planning.save(null, "skip", { plans: selected.map(plan => ({ id: plan.id, version: plan.version })) }).then(result => { if (result) setSelected([]); })}>Confirm skip {selected.length} selected occurrences</Button>}</div>
    {planning.hasMoreCatchUp && <p className="mt-2 text-sm text-muted-foreground">More missed occurrences remain. Load the next catch-up batch; each batch stays pending.</p>}
    {planning.saveError && !panel && <Alert className="mt-4"><AlertDescription>{planning.saveError} Retry the same action safely.</AlertDescription></Alert>}
    <Field className="my-5 sm:max-w-xs"><FieldLabel htmlFor="plan-status">Plan status</FieldLabel><select id="plan-status" className={select} value={planning.status} onChange={event => planning.changeStatus(event.target.value)}><option value="pending">Pending review</option><option value="satisfied">Satisfied</option><option value="cancelled">Cancelled</option><option value="all">All plans</option></select></Field>
    {planning.notice && <p role="status" className="mb-4 text-sm">{planning.notice}</p>}
    {planning.error ? <Alert><AlertDescription>{planning.error}<Button variant="outline" className={control} onClick={() => void planning.refresh()}>Retry plans</Button></AlertDescription></Alert> : planning.loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading plans…</p> : planning.page?.plans.length ? <ul className="divide-y divide-border">{planning.page.plans.map(plan => <li key={plan.id}>{plan.schedule_id && plan.status === "pending" && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4" style={{ accentColor: "#7C5CFF" }} disabled={planning.busy} checked={selected.some(row => row.id === plan.id)} onChange={event => setSelected(rows => event.target.checked ? [...rows, plan] : rows.filter(row => row.id !== plan.id))} />Select occurrence due {plan.due_date} for skipping</label>}<button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => open(plan.id)} aria-label={`Review ${plan.type} plan ${money(plan.amount_cents)} due ${plan.due_date}`}>
      <span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{plan.text || plan.category_name || "Uncategorized"}</span><span className="mt-1 block break-words text-sm text-muted-foreground">{plan.schedule_id ? "Recurring · " : ""}Due {plan.due_date} · {plan.account_name} · {plan.status === "pending" ? plan.due_date < today ? "Overdue" : plan.due_date === today ? "Due today" : "Upcoming" : plan.status === "satisfied" ? "Satisfied" : "Cancelled"}</span></span>
      <span className="text-right text-sm"><span className="block">Planned {plan.type}</span><strong className="tabular-nums">{money(plan.amount_cents)}</strong></span>
    </button></li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>No {planning.status === "all" ? "" : planning.status} plans</EmptyTitle><EmptyDescription>Add expected income or an expense. It stays separate from actual activity until reviewed.</EmptyDescription></EmptyHeader></Empty>}
    {planning.page && planning.page.total > 25 && <nav aria-label="Plan pages" className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!planning.offset || planning.loading} onClick={() => planning.setOffset(Math.max(0, planning.offset - 25))}>Previous plans</Button><span className="text-sm">{planning.offset + 1}-{Math.min(planning.offset + 25, planning.page.total)} of {planning.page.total}</span><Button variant="outline" className={control} disabled={planning.offset + 25 >= planning.page.total || planning.loading} onClick={() => planning.setOffset(planning.offset + 25)}>Next plans</Button></nav>}
    <Sheet open={panel !== null} onOpenChange={value => { if (!value && !planning.busy) setPanel(null); }}><SheetContent className={financeSheet} showCloseButton={false}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>{panel === "create" ? "Add one-time plan" : "Review planned activity"}</SheetTitle><SheetDescription>Due dates describe expectations. Transaction dates describe money that actually moved.</SheetDescription></SheetHeader>
      {detailError ? <div className="flex flex-col gap-4 p-6"><Alert><AlertDescription>{detailError}</AlertDescription></Alert><Button variant="outline" className={control} onClick={() => setReload(value => value + 1)}>Retry plan inspection</Button><Button variant="outline" className={control} onClick={() => setPanel(null)}>Close plan</Button></div> : panel === "create" || detail ? <PlanPanel key={`${panel}:${detail?.version ?? "new"}:${reload}`} plan={detail} activity={activity} planning={planning} onClose={() => setPanel(null)} onFuture={plan => { setPanel(null); setFutureOccurrence(plan); }} onRefresh={() => { planning.resetSave(); setReload(value => value + 1); }} /> : <div className="flex flex-col gap-4 p-6"><p role="status">Loading plan…</p><Button variant="outline" className={control} onClick={() => setPanel(null)}>Close plan</Button></div>}
    </SheetContent></Sheet>
  </section><FinanceObligations activity={activity} /></>;
}

function PlanPanel({ plan, activity, planning, onClose, onFuture, onRefresh }: { plan: FinancePlan | null; activity: FinanceActivityController; planning: FinancePlanningController; onClose: () => void; onFuture: (plan: FinancePlan) => void; onRefresh: () => void }) {
  const { mode, type, amount, setAmount, account, setAccount, dueDate, setDueDate, date, setDate, category, subcategory, setSubcategory, text, setText, errors, editable, categories, subcategories, accounts, submit: save, changeMode, changeType, changeCategory, invalid } = useFinancePlanEntry(plan, activity, planning, onClose);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save((event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another");
  }
  return <div className="flex flex-1 flex-col gap-5 p-6">
    {plan && <p className="text-sm">Planned {plan.type}: <strong className="tabular-nums">{money(plan.amount_cents)}</strong>. Due {plan.due_date} in {plan.account_name}. Status: {plan.status}.</p>}
    {plan && !editable && <p className="text-sm text-muted-foreground">{plan.status === "satisfied" ? "Satisfied by a recorded transaction. Inspect it in Activity to correct, Delete or Revert. Delete preserves satisfaction; Revert reopens this plan." : "Cancelled without cash movement. Create a new plan if this expectation returns."}</p>}
    {plan && editable && <div className="flex flex-wrap gap-2" aria-label="Plan actions"><Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("edit")}>{plan.schedule_id ? "Edit this occurrence only" : "Edit / reschedule"}</Button>{plan.schedule_id && <Button variant="outline" className={control} disabled={planning.busy} onClick={() => onFuture(plan)}>Edit this and future occurrences</Button>}<Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("post")}>Post actual activity</Button><Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("match")}>Match existing activity</Button><Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("cancel")}>{plan.schedule_id ? "Skip occurrence" : "Cancel plan"}</Button></div>}
    {editable && (mode === "match" && plan ? <FinancePlanMatch plan={plan} planning={planning} onSaved={onClose} /> : mode === "cancel" && plan ? <section className="flex flex-col gap-4"><p className="text-sm">{plan.schedule_id ? "Skip this pending occurrence?" : "Cancel this pending expectation?"} It will leave forecasts and pending review. No balances or actual spending change.</p><Button className={control} disabled={planning.busy} onClick={() => void planning.save(plan.schedule_id ? null : plan.id, plan.schedule_id ? "skip" : "cancel", plan.schedule_id ? { plans: [{ id: plan.id, version: plan.version }] } : { version: plan.version }).then(result => { if (result) onClose(); })}>{planning.busy ? "Cancelling…" : plan.schedule_id ? "Confirm skip" : "Confirm cancellation"}</Button></section> : <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <h3 className="text-base font-semibold">{mode === "post" ? "Confirm what actually happened" : plan ? "Edit expected activity" : "Expected activity"}</h3>
      <FieldGroup>
        {mode !== "post" && <Field><FieldLabel htmlFor="plan-type">Plan type</FieldLabel><select id="plan-type" className={select} value={type} disabled={planning.busy} onChange={event => changeType(event.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></Field>}
        <Field data-invalid={!!errors.amount}><FieldLabel htmlFor="plan-amount">{mode === "post" ? "Actual amount (PHP)" : "Expected amount (PHP)"}</FieldLabel><Input id="plan-amount" inputMode="decimal" value={amount} disabled={planning.busy} onChange={event => setAmount(event.target.value)} className={control} {...invalid("amount")} /><FieldError id="plan-error-amount">{errors.amount}</FieldError></Field>
        <Field data-invalid={!!errors.account_id}><FieldLabel htmlFor="plan-account_id">{mode === "post" ? "Actual account" : "Expected account"}</FieldLabel><select id="plan-account_id" className={select} value={account} disabled={planning.busy} onChange={event => setAccount(event.target.value)} {...invalid("account_id")}><option value="">Choose a money account</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}{row.archived ? " (archived)" : ""}</option>)}</select><FieldError id="plan-error-account_id">{errors.account_id}</FieldError></Field>
        {mode === "post" ? <Field data-invalid={!!errors.transaction_date}><FieldLabel htmlFor="plan-transaction_date">Actual transaction date</FieldLabel><FinanceDateInput id="plan-transaction_date" min="1000-01-01" max="9999-12-31" value={date} disabled={planning.busy} onChange={setDate} {...invalid("transaction_date")} /><FieldDescription>The day money moved. Posting creates one actual transaction; the due date stays unchanged.</FieldDescription><FieldError id="plan-error-transaction_date">{errors.transaction_date}</FieldError></Field> : <>
          <Field data-invalid={!!errors.due_date}><FieldLabel htmlFor="plan-due_date">Due date</FieldLabel><FinanceDateInput id="plan-due_date" min="1000-01-01" max="9999-12-31" value={dueDate} disabled={planning.busy} onChange={setDueDate} {...invalid("due_date")} /><FieldDescription>When you expect the activity, not a posting date.</FieldDescription><FieldError id="plan-error-due_date">{errors.due_date}</FieldError></Field>
          <Field><FieldLabel htmlFor="plan-category">Category</FieldLabel><select id="plan-category" className={select} value={category} disabled={planning.busy} onChange={event => changeCategory(event.target.value)}><option value="">Uncategorized</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
          {subcategories.length > 0 && <Field><FieldLabel htmlFor="plan-subcategory">Subcategory</FieldLabel><select id="plan-subcategory" className={select} value={subcategory} disabled={planning.busy} onChange={event => setSubcategory(event.target.value)}><option value="">No subcategory</option>{subcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
          <Field><FieldLabel htmlFor="plan-text">Plan text (optional)</FieldLabel><Input id="plan-text" maxLength={2000} value={text} disabled={planning.busy} className={control} onChange={event => setText(event.target.value)} /></Field>
        </>}
      </FieldGroup>
      <FinanceOptionStatus activity={activity} />
      {mode === "post" && <p className="text-sm text-muted-foreground">Confirming changes the selected account balance once. If already recorded, use Match existing activity instead.</p>}
      <div className="flex flex-wrap justify-end gap-3">{!plan && <Button type="submit" name="another" variant="outline" className={control} disabled={planning.busy}>Save and add another plan</Button>}<Button type="submit" className={control} disabled={planning.busy}>{planning.busy ? "Saving…" : mode === "post" ? "Confirm and post" : plan ? "Save plan changes" : "Save plan"}</Button></div>
    </form>)}
    {planning.saveError && <Alert><AlertDescription>{planning.saveError} Retry unchanged fields for a safe request retry.{plan && <Button variant="outline" className={control} disabled={planning.busy} onClick={onRefresh}>Refresh plan before editing</Button>}</AlertDescription></Alert>}
    <Button variant="outline" className={`${control} mt-auto self-end`} disabled={planning.busy} onClick={onClose}>Close plan</Button>
  </div>;
}
