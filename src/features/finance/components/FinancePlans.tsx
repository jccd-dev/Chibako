"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceObligation, FinanceObligationList } from "@/features/finance/obligation-types";
import { useFinancePlanEntry } from "@/features/finance/use-finance-plan-entry";
import { financeJson } from "@/features/finance/client-json";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP as money, localCalendarDate } from "@/features/finance/presentation";
import { Button } from "@/components/ui/button";
import { FinanceDateInput } from "./FinanceDateInputs";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { FinanceOptionStatus } from "./FinanceActivity";
import { FinancePlanMatch } from "./FinancePlanMatch";
import { FinanceObligations } from "./FinanceObligations";
import { FinanceRecurrence } from "./FinanceRecurrence";

export interface ReminderOptions { obligations: FinanceObligation[]; loading: boolean; error: string; reload: () => void; hasMore: boolean; loadMore: () => void }

export function FinancePlans({ planning, activity }: { planning: FinancePlanningController; activity: FinanceActivityController }) {
  const [panel, setPanel] = useState<string | null>(null);
  const [detail, setDetail] = useState<FinancePlan | null>(null);
  const [detailError, setDetailError] = useState("");
  const [reload, setReload] = useState(0);
  const [futureOccurrence, setFutureOccurrence] = useState<FinancePlan | null>(null);
  const [selected, setSelected] = useState<FinancePlan[]>([]);
  const [reminders, setReminders] = useState<FinanceObligation[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [remindersError, setRemindersError] = useState("");
  const [remindersReload, setRemindersReload] = useState(0);
  const [remindersOffset, setRemindersOffset] = useState(0);
  const [remindersTotal, setRemindersTotal] = useState(0);
  useEffect(() => { setSelected([]); }, [planning.page]);
  useEffect(() => {
    setDetail(null); setDetailError("");
    if (!panel || panel === "create") return;
    const abort = new AbortController();
    void fetch(`/api/finance/plans/${panel}?include_details=true`, { signal: abort.signal }).then(financeJson<{ plan: FinancePlan }>).then(result => { if (!abort.signal.aborted) setDetail(result.plan); })
      .catch(e => { if (!abort.signal.aborted) setDetailError(e instanceof Error ? e.message : "Could not inspect plan."); });
    return () => abort.abort();
  }, [panel, reload]);
  useEffect(() => {
    const abort = new AbortController();
    setRemindersLoading(true); setRemindersError("");
    void fetch(`/api/finance/obligations?archived=false&limit=100&offset=${remindersOffset}`, { signal: abort.signal }).then(financeJson<FinanceObligationList>).then(result => {
      if (!abort.signal.aborted) { setReminders(rows => remindersOffset ? [...rows, ...result.obligations] : result.obligations); setRemindersTotal(result.total); setRemindersLoading(false); }
    }).catch(e => { if (!abort.signal.aborted) { setRemindersError(e instanceof Error ? e.message : "Could not load reminder options."); setRemindersLoading(false); } });
    return () => abort.abort();
  }, [remindersReload, remindersOffset]);
  useEffect(() => {
    const changed = () => { setRemindersOffset(0); setRemindersReload(value => value + 1); };
    window.addEventListener("finance-changed", changed);
    return () => window.removeEventListener("finance-changed", changed);
  }, []);
  const remindersOptions: ReminderOptions = { obligations: reminders, loading: remindersLoading, error: remindersError, reload: () => { setRemindersOffset(0); setRemindersReload(value => value + 1); }, hasMore: reminders.length < remindersTotal, loadMore: () => setRemindersOffset(reminders.length) };
  function reminderName(id: string) { return remindersOptions.obligations.find(row => row.id === id)?.name; }
  function open(id: string) { planning.resetSave(); setPanel(id); }
  const today = localCalendarDate();
  const reminderLabel = (id: string) => `Reminder: ${reminderName(id) ?? "obligation linked"}`;
  return <><FinanceRecurrence activity={activity} planning={planning} occurrence={futureOccurrence} onCloseOccurrence={() => setFutureOccurrence(null)} reminders={remindersOptions} /><section aria-label="Planned activity and recurring occurrences" className="mt-8 border-t border-border pt-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Planned activity and occurrences</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Expected income and expenses stay pending until you confirm actual activity. Planning never changes balances or consumes budgets.</p></div><Button className={control} onClick={() => open("create")}>Add plan</Button></div>
    <div className="mt-4 flex flex-wrap gap-3"><Button variant="outline" className={control} disabled={planning.busy} onClick={() => void planning.save(null, "catch-up", {})}>{planning.busy ? "Preparing review…" : planning.hasMoreCatchUp ? "Load more missed occurrences" : "Refresh due occurrences"}</Button>{selected.length > 0 && <Button variant="outline" className={control} disabled={planning.busy} onClick={() => void planning.save(null, "skip", { plans: selected.map(plan => ({ id: plan.id, version: plan.version })) }).then(result => { if (result) setSelected([]); })}>Confirm skip {selected.length} selected occurrences</Button>}</div>
    {planning.hasMoreCatchUp && <p className="mt-2 text-sm text-muted-foreground">More missed occurrences remain. Load the next catch-up batch; each batch stays pending.</p>}
    {planning.saveError && !panel && <Alert className="mt-4"><AlertDescription>{planning.saveError} Retry the same action safely.</AlertDescription></Alert>}
    {remindersError && <Alert className="mt-4"><AlertDescription>{remindersError}<Button variant="outline" className={control} onClick={remindersOptions.reload}>Retry reminder options</Button></AlertDescription></Alert>}
    <Field className="my-5 sm:max-w-xs"><FieldLabel htmlFor="plan-status">Plan status</FieldLabel><select id="plan-status" className={select} value={planning.status} onChange={event => planning.changeStatus(event.target.value)}><option value="pending">Pending review</option><option value="satisfied">Satisfied</option><option value="cancelled">Cancelled</option><option value="all">All plans</option></select></Field>
    {planning.notice && <p role="status" className="mb-4 text-sm">{planning.notice}</p>}
    {planning.error ? <Alert><AlertDescription>{planning.error}<Button variant="outline" className={control} onClick={() => void planning.refresh()}>Retry plans</Button></AlertDescription></Alert> : planning.loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading plans…</p> : planning.page?.plans.length ? <ul className="divide-y divide-border">{planning.page.plans.map(plan => <li key={plan.id}>{plan.schedule_id && plan.status === "pending" && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4" style={{ accentColor: "#7C5CFF" }} disabled={planning.busy} checked={selected.some(row => row.id === plan.id)} onChange={event => setSelected(rows => event.target.checked ? [...rows, plan] : rows.filter(row => row.id !== plan.id))} />Select occurrence due {plan.due_date} for skipping</label>}<button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-3 rounded-md px-1 py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => open(plan.id)} aria-label={`Review ${plan.type} plan ${money(plan.amount_cents)} due ${plan.due_date}`}>
      <span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{plan.text || plan.category_name || "Uncategorized"}</span><span className="mt-1 block break-words text-sm text-muted-foreground">{plan.schedule_id ? "Recurring · " : ""}{plan.obligation_id ? `${reminderLabel(plan.obligation_id)} · ` : ""}Due {plan.due_date} · {plan.account_name} · {plan.status === "pending" ? plan.due_date < today ? "Overdue" : plan.due_date === today ? "Due today" : "Upcoming" : plan.status === "satisfied" ? "Satisfied" : "Cancelled"}</span></span>
      <span className="text-right text-sm"><span className="block">{plan.obligation_id ? "Principal " : "Planned "}{plan.type}</span><strong className="tabular-nums">{money(plan.amount_cents)}</strong></span>
    </button></li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>No {planning.status === "all" ? "" : planning.status} plans</EmptyTitle><EmptyDescription>Add expected income or an expense. It stays separate from actual activity until reviewed.</EmptyDescription></EmptyHeader></Empty>}
    {planning.page && planning.page.total > 25 && <nav aria-label="Plan pages" className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={!planning.offset || planning.loading} onClick={() => planning.setOffset(Math.max(0, planning.offset - 25))}>Previous plans</Button><span className="text-sm">{planning.offset + 1}-{Math.min(planning.offset + 25, planning.page.total)} of {planning.page.total}</span><Button variant="outline" className={control} disabled={planning.offset + 25 >= planning.page.total || planning.loading} onClick={() => planning.setOffset(planning.offset + 25)}>Next plans</Button></nav>}
    <Sheet open={panel !== null} onOpenChange={value => { if (!value && !planning.busy) setPanel(null); }}><SheetContent className={financeSheet} showCloseButton={false}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>{panel === "create" ? "Add one-time plan" : "Review planned activity"}</SheetTitle><SheetDescription>Due dates describe expectations. Transaction dates describe money that actually moved.</SheetDescription></SheetHeader>
      {detailError ? <div className="flex flex-col gap-4 p-6"><Alert><AlertDescription>{detailError}</AlertDescription></Alert><Button variant="outline" className={control} onClick={() => setReload(value => value + 1)}>Retry plan inspection</Button><Button variant="outline" className={control} onClick={() => setPanel(null)}>Close plan</Button></div> : panel === "create" || detail ? <PlanPanel key={`${panel}:${detail?.version ?? "new"}:${reload}`} plan={detail} activity={activity} planning={planning} reminders={remindersOptions} onClose={() => setPanel(null)} onFuture={plan => { setPanel(null); setFutureOccurrence(plan); }} onRefresh={() => { planning.resetSave(); setReload(value => value + 1); }} /> : <div className="flex flex-col gap-4 p-6"><p role="status">Loading plan…</p><Button variant="outline" className={control} onClick={() => setPanel(null)}>Close plan</Button></div>}
    </SheetContent></Sheet>
  </section><FinanceObligations activity={activity} /></>;
}

function PlanPanel({ plan, activity, planning, reminders, onClose, onFuture, onRefresh }: { plan: FinancePlan | null; activity: FinanceActivityController; planning: FinancePlanningController; reminders: ReminderOptions; onClose: () => void; onFuture: (plan: FinancePlan) => void; onRefresh: () => void }) {
  const linked = !!plan?.obligation_id;
  const [reviewObligation, setReviewObligation] = useState<FinanceObligation | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewReload, setReviewReload] = useState(0);
  useEffect(() => {
    if (!plan?.obligation_id) return;
    const abort = new AbortController();
    setReviewObligation(null); setReviewLoading(true); setReviewError("");
    void fetch(`/api/finance/obligations/${plan.obligation_id}`, { signal: abort.signal }).then(financeJson<{ obligation: FinanceObligation }>).then(result => {
      if (!abort.signal.aborted) setReviewObligation(result.obligation);
    }).catch(e => { if (!abort.signal.aborted) setReviewError(e instanceof Error ? e.message : "Could not inspect obligation."); })
      .finally(() => { if (!abort.signal.aborted) setReviewLoading(false); });
    return () => abort.abort();
  }, [plan?.obligation_id, reviewReload]);
  const { mode, type, amount, setAmount, account, setAccount, dueDate, setDueDate, date, setDate, category, subcategory, setSubcategory, text, setText, association, setAssociation, feeType, changeFeeType, feeAmount, setFeeAmount, feeCategoryId, changeFeeCategory, feeSubcategoryId, setFeeSubcategoryId, feeCategories, feeSubcategories, cashSource, chooseCashSource, cashPick, selectCash, clearCash, cashPage, cashOffset, setCashOffset, cashLoading, cashError, retryCash, errors, editable, categories, subcategories, accounts, submit: save, changeMode, changeType, changeCategory, invalid } = useFinancePlanEntry(plan, activity, planning, reviewObligation, onClose);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save((event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another");
  }
  const reviewBlock = linked && (mode === "post" || mode === "match") && <section aria-label="Obligation progress" className="flex flex-col gap-3">
    {reviewError ? <Alert><AlertDescription>{reviewError}<Button variant="outline" className={control} onClick={() => setReviewReload(value => value + 1)}>Retry obligation inspection</Button></AlertDescription></Alert>
      : reviewLoading || !reviewObligation ? <p role="status">Loading outstanding principal…</p>
        : <p className="text-sm">{reviewObligation.kind === "debt" ? "Debt" : "Receivable"} <strong>{reviewObligation.name}</strong>: outstanding principal <strong className="tabular-nums">{money(reviewObligation.outstanding_cents)}</strong>.<Button variant="outline" className={`${control} mt-2`} disabled={planning.busy} onClick={() => setReviewReload(value => value + 1)}>Refresh obligation progress</Button></p>}
  </section>;
  return <div className="flex flex-1 flex-col gap-5 p-6">
    {plan && <p className="text-sm">Planned {plan.type}{linked ? " (payment reminder)" : ""}: <strong className="tabular-nums">{money(plan.amount_cents)}</strong>. Due {plan.due_date} in {plan.account_name}. Status: {plan.status}.</p>}
    {reviewBlock}
    {plan && !editable && <p className="text-sm text-muted-foreground">{plan.status === "satisfied" ? "Satisfied by a recorded transaction. Inspect it in Activity to correct, Delete or Revert. Delete preserves satisfaction; Revert reopens this plan." : "Cancelled without cash movement. Create a new plan if this expectation returns."}</p>}
    {plan && editable && <div className="flex flex-wrap gap-2" aria-label="Plan actions"><Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("edit")}>{plan.schedule_id ? "Edit this occurrence only" : "Edit / reschedule"}</Button>{plan.schedule_id && <Button variant="outline" className={control} disabled={planning.busy} onClick={() => onFuture(plan)}>Edit this and future occurrences</Button>}<Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("post")}>{linked ? "Post actual payment" : "Post actual activity"}</Button><Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("match")}>{linked ? "Match recorded principal payment" : "Match existing activity"}</Button><Button variant="outline" className={control} disabled={planning.busy} onClick={() => changeMode("cancel")}>{plan.schedule_id ? "Skip occurrence" : "Cancel plan"}</Button></div>}
    {editable && (mode === "match" && plan ? <FinancePlanMatch plan={plan} planning={planning} obligation={reviewObligation} onSaved={onClose} /> : mode === "cancel" && plan ? <section className="flex flex-col gap-4"><p className="text-sm">{plan.schedule_id ? "Skip this pending occurrence?" : "Cancel this pending expectation?"} It will leave forecasts and pending review. No balances, cash or obligation progress change.</p><Button className={control} disabled={planning.busy} onClick={() => void planning.save(plan.schedule_id ? null : plan.id, plan.schedule_id ? "skip" : "cancel", plan.schedule_id ? { plans: [{ id: plan.id, version: plan.version }] } : { version: plan.version }).then(result => { if (result) onClose(); })}>{planning.busy ? "Cancelling…" : plan.schedule_id ? "Confirm skip" : "Confirm cancellation"}</Button></section> : <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <h3 className="text-base font-semibold">{mode === "post" ? linked ? "Confirm the actual principal payment" : "Confirm what actually happened" : plan ? "Edit expected activity" : "Expected activity"}</h3>
      <FieldGroup>
        {mode !== "post" && <Field><FieldLabel htmlFor="plan-type">Plan type</FieldLabel><select id="plan-type" className={select} value={type} disabled={planning.busy} onChange={event => changeType(event.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></Field>}
        <Field data-invalid={!!errors.amount}><FieldLabel htmlFor="plan-amount">{mode === "post" ? linked ? "Principal amount (PHP)" : "Actual amount (PHP)" : "Expected amount (PHP)"}</FieldLabel><Input id="plan-amount" inputMode="decimal" value={amount} disabled={planning.busy || cashSource === "existing" && !!cashPick && mode === "post"} onChange={event => setAmount(event.target.value)} className={control} {...invalid("amount")} /><FieldError id="plan-error-amount">{errors.amount}</FieldError></Field>
        <Field data-invalid={!!errors.account_id}><FieldLabel htmlFor="plan-account_id">{mode === "post" ? linked ? "Cash account" : "Actual account" : "Expected account"}</FieldLabel><select id="plan-account_id" className={select} value={account} disabled={planning.busy || cashSource === "existing" && !!cashPick && mode === "post"} onChange={event => setAccount(event.target.value)} {...invalid("account_id")}><option value="">Choose a money account</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}{row.archived ? " (archived)" : ""}</option>)}</select><FieldError id="plan-error-account_id">{errors.account_id}</FieldError></Field>
        {mode !== "post" && plan?.schedule_id && <Field><FieldLabel htmlFor="plan-association">Reminder association (this occurrence only)</FieldLabel><select id="plan-association" className={select} value={association} disabled={planning.busy || reminders.loading} onChange={event => setAssociation(event.target.value)}><option value="">Not associated</option>{reminders.obligations.filter(row => row.kind === (type === "expense" ? "debt" : "receivable")).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{reminders.hasMore && <Button type="button" variant="outline" className={control} disabled={reminders.loading || planning.busy} onClick={reminders.loadMore}>Load more obligations</Button>}<FieldDescription>Changing this applies only to this occurrence; the schedule keeps its own association for future occurrences.</FieldDescription></Field>}
        {mode === "post" ? <Field data-invalid={!!errors.transaction_date}><FieldLabel htmlFor="plan-transaction_date">Actual transaction date</FieldLabel><FinanceDateInput id="plan-transaction_date" min="1000-01-01" max="9999-12-31" value={date} disabled={planning.busy || cashSource === "existing" && !!cashPick} onChange={setDate} {...invalid("transaction_date")} /><FieldDescription>{linked ? "The day the principal moved. The obligation payment and plan update together." : "The day money moved. Posting creates one actual transaction; the due date stays unchanged."}</FieldDescription><FieldError id="plan-error-transaction_date">{errors.transaction_date}</FieldError></Field> : <>
          <Field data-invalid={!!errors.due_date}><FieldLabel htmlFor="plan-due_date">Due date</FieldLabel><FinanceDateInput id="plan-due_date" min="1000-01-01" max="9999-12-31" value={dueDate} disabled={planning.busy} onChange={setDueDate} {...invalid("due_date")} /><FieldDescription>When you expect the activity, not a posting date.</FieldDescription><FieldError id="plan-error-due_date">{errors.due_date}</FieldError></Field>
          <Field><FieldLabel htmlFor="plan-category">Category</FieldLabel><select id="plan-category" className={select} value={category} disabled={planning.busy} onChange={event => changeCategory(event.target.value)}><option value="">Uncategorized</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
          {subcategories.length > 0 && <Field><FieldLabel htmlFor="plan-subcategory">Subcategory</FieldLabel><select id="plan-subcategory" className={select} value={subcategory} disabled={planning.busy} onChange={event => setSubcategory(event.target.value)}><option value="">No subcategory</option>{subcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
          <Field><FieldLabel htmlFor="plan-text">Plan text (optional)</FieldLabel><Input id="plan-text" maxLength={2000} value={text} disabled={planning.busy} className={control} onChange={event => setText(event.target.value)} /></Field>
        </>}
        {mode === "post" && linked && !cashPick && <FieldSet>
          <FieldLegend>Separate interest or fee (optional)</FieldLegend>
          <FieldDescription>Posted as its own linked activity next to the principal payment. Leave the amount blank to skip.</FieldDescription>
          <Field><FieldLabel htmlFor="plan-fee-type">Fee type</FieldLabel><select id="plan-fee-type" className={select} value={feeType} disabled={planning.busy} onChange={event => changeFeeType(event.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></Field>
          <Field data-invalid={!!errors.fee}><FieldLabel htmlFor="plan-fee-amount">Fee amount (PHP)</FieldLabel><Input id="plan-fee-amount" inputMode="decimal" className={control} value={feeAmount} disabled={planning.busy} onChange={event => setFeeAmount(event.target.value)} {...invalid("fee")} /><FieldError id="plan-error-fee">{errors.fee}</FieldError></Field>
          <Field><FieldLabel htmlFor="plan-fee-category">Fee category</FieldLabel><select id="plan-fee-category" className={select} value={feeCategoryId} disabled={planning.busy} onChange={event => changeFeeCategory(event.target.value)}><option value="">Uncategorized</option>{feeCategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
          {!!feeSubcategories.length && <Field><FieldLabel htmlFor="plan-fee-subcategory">Fee subcategory</FieldLabel><select id="plan-fee-subcategory" className={select} value={feeSubcategoryId} disabled={planning.busy} onChange={event => setFeeSubcategoryId(event.target.value)}><option value="">No subcategory</option>{feeSubcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
        </FieldSet>}
        {mode === "post" && linked && <FieldSet>
          <FieldLegend>Cash effect</FieldLegend>
          <FieldDescription>{cashPick ? "Cash was already recorded; no new cash moves and a separate fee cannot be added." : "Post new cash activity, or link cash already recorded for this payment."}</FieldDescription>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Cash effect source">
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="plan-cash-source" className="size-4 accent-primary" disabled={planning.busy} checked={cashSource === "new"} onChange={() => chooseCashSource("new")} />Post new cash activity</label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="plan-cash-source" className="size-4 accent-primary" disabled={planning.busy} checked={cashSource === "existing"} onChange={() => chooseCashSource("existing")} />Link already recorded activity</label>
          </div>
          {cashSource === "existing" && <section aria-label="Link existing cash activity" className="flex flex-col gap-3">
            {cashError ? <Alert><AlertDescription>{cashError}<Button type="button" variant="outline" className={control} onClick={retryCash}>Retry payment activity</Button></AlertDescription></Alert>
              : cashLoading || !cashPage ? <p role="status">Loading payment activity…</p>
                : cashPage?.transactions.length ? <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">Choose one transaction</legend>
                  {cashPage.transactions.map(row => <label key={row.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
                    <input type="radio" name="plan-cash-activity" className="mt-1 size-4 shrink-0 accent-primary" disabled={planning.busy} checked={cashPick?.id === row.id} onChange={() => selectCash(row)} />
                    <span className="min-w-0 break-words"><strong className="tabular-nums">{money(row.amount_cents)}</strong> · {row.transaction_date}<span className="block">{row.account_name} · {row.category_name ?? "Uncategorized"}</span>{row.text && <span className="mt-1 block text-muted-foreground">{row.text}</span>}</span>
                  </label>)}
                </fieldset>
                  : <p className="text-sm text-muted-foreground">No eligible recorded activity. Post new cash activity instead.</p>}
            {cashPage && cashPage.total > 25 && <nav aria-label="Payment activity pages" className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" className={control} disabled={!cashOffset || planning.busy} onClick={() => setCashOffset(Math.max(0, cashOffset - 25))}>Previous payments</Button><span className="text-sm">{cashOffset + 1}-{Math.min(cashOffset + 25, cashPage.total)} of {cashPage.total}</span><Button type="button" variant="outline" className={control} disabled={cashOffset + 25 >= cashPage.total || planning.busy} onClick={() => setCashOffset(cashOffset + 25)}>Next payments</Button></nav>}
            {cashPick && <p className="text-sm">Link {money(cashPick.amount_cents)} on {cashPick.transaction_date}. Cash stays as recorded; the payment progress alone is new.</p>}
            <Button type="button" variant="outline" className={`${control} self-start`} disabled={!cashPick || planning.busy} onClick={clearCash}>Clear selection</Button>
          </section>}
        </FieldSet>}
      </FieldGroup>
      <FinanceOptionStatus activity={activity} />
      {mode === "post" && <p className="text-sm text-muted-foreground">{linked ? "Confirming records the principal payment, updates obligation progress and satisfies this occurrence. If already recorded, link it above instead of posting again." : "Confirming changes the selected account balance once. If already recorded, use Match existing activity instead."}</p>}
      <div className="flex flex-wrap justify-end gap-3">{!plan && <Button type="submit" name="another" variant="outline" className={control} disabled={planning.busy}>Save and add another plan</Button>}<Button type="submit" className={control} disabled={planning.busy || mode === "post" && linked && (!!reviewError || !reviewObligation || reviewObligation.outstanding_cents <= 0 || cashSource === "existing" && !cashPick)}>{planning.busy ? "Saving…" : mode === "post" ? linked ? "Confirm and post payment" : "Confirm and post" : plan ? "Save plan changes" : "Save plan"}</Button></div>
    </form>)}
    {planning.saveError && <Alert><AlertDescription>{planning.saveError} Retry unchanged fields for a safe request retry.{plan && <Button variant="outline" className={control} disabled={planning.busy} onClick={onRefresh}>Refresh plan before editing</Button>}</AlertDescription></Alert>}
    <Button variant="outline" className={`${control} mt-auto self-end`} disabled={planning.busy} onClick={onClose}>Close plan</Button>
  </div>;
}
