"use client";


import { useEffect, useState, type FormEvent } from "react";
import { format } from "date-fns";
import type { FinancePlan } from "@/features/finance/planning-types";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceObligation, FinanceObligationList } from "@/features/finance/obligation-types";
import { useFinancePlanEntry } from "@/features/finance/use-finance-plan-entry";
import { financeJson } from "@/features/finance/client-json";
import { financeDrawerFooter, financeSheet, formatPHP as money, localCalendarDate } from "@/features/finance/presentation";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { FinanceDateInput } from "./FinanceDateInputs";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { FinanceOptionStatus } from "./FinanceActivity";
import { FinancePlanMatch } from "./FinancePlanMatch";
import { FinanceRecurrence } from "./FinanceRecurrence";
import { FinancePlanCategories } from "./FinancePlanCategories";
import { MoneyInput } from "./MoneyInput";
import { FinancePlanningList } from "./FinancePlanningList";
import { useFinancePlanningList } from "../use-finance-planning-list";

export interface ReminderOptions { obligations: FinanceObligation[]; loading: boolean; error: string; reload: () => void; hasMore: boolean; loadMore: () => void }

export function FinancePlans({
  planning,
  activity,
  focusPlanId,
  onFocusHandled,
}: {
  planning: FinancePlanningController;
  activity: FinanceActivityController;
  focusPlanId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [panel, setPanel] = useState<string | null>(focusPlanId ?? null);
  const [detail, setDetail] = useState<{ key: string; value: FinancePlan } | null>(null);
  const [detailErrorState, setDetailError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [futureOccurrence, setFutureOccurrence] = useState<FinancePlan | null>(null);
  const [scheduleSelection, setScheduleSelection] = useState<string | null>(null);
  const list = useFinancePlanningList();
  const [remindersState, setReminders] = useState<{ key: string; values: FinanceObligation[]; total: number } | null>(null);
  const [remindersErrorState, setRemindersError] = useState<{ key: string; message: string } | null>(null);
  const [remindersReload, setRemindersReload] = useState(0);
  const [remindersOffset, setRemindersOffset] = useState(0);
  const [previousFocusPlanId, setPreviousFocusPlanId] = useState(focusPlanId);
  const detailKey = `${panel ?? ""}:${reload}`;
  const remindersKey = `${remindersReload}:${remindersOffset}`;
  const detailValue = detail?.key === detailKey ? detail.value : null;
  const detailError = detailErrorState?.key === detailKey ? detailErrorState.message : "";
  const reminders = remindersState?.values ?? [];
  const remindersTotal = remindersState?.total ?? 0;
  const remindersLoading = remindersState?.key !== remindersKey && remindersErrorState?.key !== remindersKey;
  const remindersError = remindersErrorState?.key === remindersKey ? remindersErrorState.message : "";
  if (previousFocusPlanId !== focusPlanId) {
    setPreviousFocusPlanId(focusPlanId);
    if (focusPlanId) { setPanel(focusPlanId); setReload(value => value + 1); }
  }
  useEffect(() => {
    if (!focusPlanId) return;
    onFocusHandled?.();
  }, [focusPlanId, onFocusHandled]);
  useEffect(() => {
    if (!panel || panel === "create") return;
    const abort = new AbortController();
    void fetch(`/api/finance/plans/${panel}?include_details=true`, { signal: abort.signal }).then(financeJson<{ plan: FinancePlan }>).then(result => { if (!abort.signal.aborted) setDetail({ key: detailKey, value: result.plan }); })
      .catch(e => { if (!abort.signal.aborted) setDetailError({ key: detailKey, message: e instanceof Error ? e.message : "Could not inspect plan." }); });
    return () => abort.abort();
  }, [panel, reload, detailKey]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/finance/obligations?archived=false&limit=100&offset=${remindersOffset}`, { signal: abort.signal }).then(financeJson<FinanceObligationList>).then(result => {
      if (!abort.signal.aborted) setReminders(current => ({ key: remindersKey, values: remindersOffset ? [...(current?.values ?? []), ...result.obligations] : result.obligations, total: result.total }));
    }).catch(e => { if (!abort.signal.aborted) setRemindersError({ key: remindersKey, message: e instanceof Error ? e.message : "Could not load reminder options." }); });
    return () => abort.abort();
  }, [remindersReload, remindersOffset, remindersKey]);
  useEffect(() => {
    const changed = () => { setRemindersOffset(0); setRemindersReload(value => value + 1); };
    window.addEventListener("finance-changed", changed);
    return () => window.removeEventListener("finance-changed", changed);
  }, []);
  const remindersOptions: ReminderOptions = { obligations: reminders, loading: remindersLoading, error: remindersError, reload: () => { setRemindersOffset(0); setRemindersReload(value => value + 1); }, hasMore: reminders.length < remindersTotal, loadMore: () => setRemindersOffset(reminders.length) };
  function open(id: string) { planning.resetSave(); setReload(value => value + 1); setPanel(id); }
  return <>
    <FinancePlanningList list={list} busy={planning.busy} onAdd={() => { planning.resetSave(); setScheduleSelection("create"); }} onOpen={item => { if (item.kind === "schedule") setScheduleSelection(item.id); else open(item.id); }} />
    <FinanceRecurrence activity={activity} planning={planning} selection={scheduleSelection} onCloseSelection={() => setScheduleSelection(null)} occurrence={futureOccurrence} onCloseOccurrence={() => setFutureOccurrence(null)} renderPayment={(plan, onDone, onRefresh) => <PlanPanel key={`${plan.id}:${plan.version}`} plan={plan} activity={activity} planning={planning} reminders={remindersOptions} onClose={onDone} onFuture={value => { onDone(); setFutureOccurrence(value); }} onRefresh={onRefresh} inline />} reminders={remindersOptions} />
    {planning.notice && <p role="status" className="mt-4 text-sm">{planning.notice}</p>}
    {planning.saveError && !panel && <Alert className="mt-4"><AlertDescription>{planning.saveError} Retry the same action safely.</AlertDescription></Alert>}
    {remindersError && <Alert className="mt-4"><AlertDescription>{remindersError}<Button variant="outline" onClick={remindersOptions.reload}>Retry reminder options</Button></AlertDescription></Alert>}
    <Sheet open={panel !== null} onOpenChange={value => { if (!value && !planning.busy) setPanel(null); }}><SheetContent className={`${financeSheet} overscroll-contain`}>
      <SheetHeader className="border-b border-border p-4 pr-10"><SheetTitle>Review payment</SheetTitle><SheetDescription>Log what happened, match recorded activity, or delete the plan.</SheetDescription></SheetHeader>
      {detailError ? <div className="flex flex-col gap-4 p-4"><Alert><AlertDescription>{detailError}</AlertDescription></Alert><Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry plan inspection</Button><Button variant="outline" onClick={() => setPanel(null)}>Close plan</Button></div> : panel === "create" || detailValue ? <PlanPanel key={`${panel}:${detailValue?.version ?? "new"}:${reload}`} plan={detailValue} activity={activity} planning={planning} reminders={remindersOptions} onClose={() => setPanel(null)} onFuture={plan => { setPanel(null); setFutureOccurrence(plan); }} onRefresh={() => { planning.resetSave(); setReload(value => value + 1); }} /> : <div className="flex flex-col gap-4 p-4"><p role="status">Loading plan…</p><Button variant="outline" onClick={() => setPanel(null)}>Close plan</Button></div>}
    </SheetContent></Sheet>
  </>;
}

function humanDate(iso: string) {
  return format(new Date(`${iso}T12:00:00`), "MMMM d, yyyy");
}

export function PlanPanel({ plan, activity, planning, reminders, onClose, onFuture, onRefresh, inline = false }: { plan: FinancePlan | null; activity: FinanceActivityController; planning: FinancePlanningController; reminders: ReminderOptions; onClose: () => void; onFuture: (plan: FinancePlan) => void; onRefresh: () => void; inline?: boolean }) {
  const linked = !!plan?.obligation_id;
  const [reviewState, setReviewState] = useState<{ key: string; value: FinanceObligation } | null>(null);
  const [reviewErrorState, setReviewError] = useState<{ key: string; message: string } | null>(null);
  const [reviewReload, setReviewReload] = useState(0);
  const reviewKey = `${plan?.obligation_id ?? ""}:${reviewReload}`;
  const reviewObligation = reviewState?.key === reviewKey ? reviewState.value : null;
  const reviewError = reviewErrorState?.key === reviewKey ? reviewErrorState.message : "";
  const reviewLoading = !!plan?.obligation_id && !reviewObligation && !reviewError;
  useEffect(() => {
    if (!plan?.obligation_id) return;
    const abort = new AbortController();
    void fetch(`/api/finance/obligations/${plan.obligation_id}`, { signal: abort.signal }).then(financeJson<{ obligation: FinanceObligation }>).then(result => {
      if (!abort.signal.aborted) setReviewState({ key: reviewKey, value: result.obligation });
    }).catch(e => { if (!abort.signal.aborted) setReviewError({ key: reviewKey, message: e instanceof Error ? e.message : "Could not inspect obligation." }); });
    return () => abort.abort();
  }, [plan?.obligation_id, reviewReload, reviewKey]);
  const { mode, type, amount, setAmount, account, setAccount, dueDate, setDueDate, date, setDate, category, subcategory, setSubcategory, text, setText, association, setAssociation, feeType, changeFeeType, feeAmount, setFeeAmount, feeCategoryId, changeFeeCategory, feeSubcategoryId, setFeeSubcategoryId, feeCategories, feeSubcategories, cashSource, chooseCashSource, cashPick, selectCash, clearCash, cashPage, cashOffset, setCashOffset, cashLoading, cashError, retryCash, errors, editable, shortfall, accounts, submit: save, changeMode, changeType, changeCategory, invalid } = useFinancePlanEntry(plan, activity, planning, reviewObligation, onClose);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save((event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "another");
  }
  const reviewBlock = linked && (mode === "post" || mode === "match") && <section aria-label="Obligation progress" className="flex flex-col gap-3">
    {reviewError ? <Alert><AlertDescription>{reviewError}<Button variant="outline" onClick={() => setReviewReload(value => value + 1)}>Retry obligation inspection</Button></AlertDescription></Alert>
      : reviewLoading || !reviewObligation ? <p role="status">Loading outstanding principal…</p>
        : <p className="text-sm">{reviewObligation.kind === "debt" ? "Debt" : "Receivable"} <strong>{reviewObligation.name}</strong>: outstanding principal <strong className="tabular-nums">{money(reviewObligation.outstanding_cents)}</strong>.<Button variant="outline" className="mt-2" disabled={planning.busy} onClick={() => setReviewReload(value => value + 1)}>Refresh obligation progress</Button></p>}
  </section>;
  const today = localCalendarDate();
  const pendingPlan = plan?.status === "pending";
  const planStatus = !plan ? "" : !pendingPlan ? plan.status === "satisfied" ? "Recorded" : "Skipped" : plan.due_date < today ? "Overdue" : plan.due_date === today ? "Due today" : "Pending";
  return <div className={inline ? "flex flex-col gap-4 rounded-xl border border-border bg-background p-4" : "flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0"}>
    {!(inline && mode === "post") && plan && <section aria-label="Plan summary" className="rounded-xl bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{plan.text || plan.category_name || (plan.type === "income" ? "Planned income" : "Planned expense")}</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">{plan.category_name || "Uncategorized"} · {plan.account_name}</p>
        </div>
        <div className="shrink-0 text-right"><p className="text-base font-semibold tabular-nums">{money(plan.amount_cents)}</p></div>
      </div>
      <p className="mt-3 text-sm">{plan.status === "pending" ? <>{plan.schedule_id ? "Due" : "Expected"} {humanDate(plan.due_date)}</> : humanDate(plan.due_date)} · {planStatus} · {plan.handling === "automatic" ? "Automatic" : "Manual"}</p>
      <p className="mt-1 text-xs text-muted-foreground">Planned time {plan.logged_time} ({plan.timezone}).{plan.status === "pending" ? plan.handling === "automatic" ? " Records automatically when due while the server is running." : " Manual confirmation required." : ""}</p>
    </section>}
    {reviewBlock}
    {plan && !editable && <p className="text-sm text-muted-foreground">{plan.status === "satisfied" ? "Satisfied by a recorded transaction. Inspect it in Activity to correct, Delete or Revert. Delete preserves satisfaction; Revert reopens this plan." : "Cancelled without cash movement. Create a new plan if this expectation returns."}</p>}
    {plan && editable && !(inline && mode === "post") && <div className="flex flex-wrap gap-2" aria-label="Plan actions"><Button variant={mode === "post" ? "default" : "outline"} disabled={planning.busy} onClick={() => changeMode("post")}>{plan.type === "expense" ? "Log payment" : "Log income"}</Button><Button variant={mode === "edit" ? "default" : "outline"} disabled={planning.busy} onClick={() => changeMode("edit")}>{plan.schedule_id ? "Edit occurrence" : "Edit"}</Button><Button variant={mode === "match" ? "default" : "outline"} disabled={planning.busy} onClick={() => changeMode("match")}>Match activity</Button><Button variant="outline" className="text-destructive" disabled={planning.busy} onClick={() => changeMode("cancel")}>{plan.schedule_id ? "Skip occurrence" : "Delete plan"}</Button>{plan.schedule_id && <Button variant="outline" disabled={planning.busy} onClick={() => onFuture(plan)}>Edit this and future occurrences</Button>}</div>}
    {plan && editable && inline && mode === "post" && <Button variant="outline" size="sm" className="self-start" disabled={planning.busy} onClick={() => changeMode("match")}>Match existing activity instead</Button>}
    {editable && (mode === "match" && plan ? <FinancePlanMatch plan={plan} planning={planning} obligation={reviewObligation} onSaved={onClose} /> : mode === "cancel" && plan ? <section className="flex flex-col gap-4"><p className="text-sm">{plan.schedule_id ? "Skip this pending occurrence?" : "Delete this pending plan?"} {plan.schedule_id ? "It will leave forecasts and pending review." : "It will leave forecasts and pending review. Create a new plan if this expectation returns."} No balances, cash or obligation progress change.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={planning.busy} onClick={() => changeMode("post")}>Back to review</Button><Button variant="destructive" disabled={planning.busy} onClick={() => void planning.save(plan.schedule_id ? null : plan.id, plan.schedule_id ? "skip" : "cancel", plan.schedule_id ? { plans: [{ id: plan.id, version: plan.version }] } : { version: plan.version }).then(result => { if (result) onClose(); })}>{planning.busy ? "Working…" : plan.schedule_id ? "Confirm skip" : "Delete plan"}</Button></div></section> : <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {mode === "post" && plan && linked && <h3 className="text-base font-semibold">Log principal payment</h3>}
      {mode === "post" && !plan && <h3 className="text-base font-semibold">Expected activity</h3>}
      {mode !== "post" && <h3 className="text-base font-semibold">{plan ? "Edit expected activity" : "Expected activity"}</h3>}
      <FieldGroup className="gap-6">
        {mode !== "post" && <Field><FieldLabel htmlFor="plan-type">Plan type</FieldLabel><NativeSelect id="plan-type" className="w-full" value={type} disabled={planning.busy} onChange={event => changeType(event.target.value)}><NativeSelectOption value="expense">Expense</NativeSelectOption><NativeSelectOption value="income">Income</NativeSelectOption></NativeSelect></Field>}
        <Field data-invalid={!!errors.amount}><FieldLabel htmlFor="plan-amount">{mode === "post" ? linked ? "Principal amount (PHP)" : "Amount (PHP)" : "Expected amount (PHP)"}</FieldLabel><MoneyInput id="plan-amount" autoFocus={inline} inputMode="decimal" className="tabular-nums" placeholder="0.00" value={amount} disabled={planning.busy || cashSource === "existing" && !!cashPick && mode === "post"} onValueChange={value => setAmount(value)} {...invalid("amount")} /><FieldError id="plan-error-amount">{errors.amount}</FieldError></Field>
        <Field data-invalid={!!errors.account_id}><FieldLabel htmlFor="plan-account_id">{mode === "post" ? "Account" : "Expected account"}</FieldLabel><NativeSelect id="plan-account_id" className="w-full" value={account} disabled={planning.busy || cashSource === "existing" && !!cashPick && mode === "post"} onChange={event => setAccount(event.target.value)} {...invalid("account_id")}><NativeSelectOption value="">Choose a money account</NativeSelectOption>{accounts.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}{row.archived ? " (archived)" : ""}</NativeSelectOption>)}</NativeSelect><FieldError id="plan-error-account_id">{errors.account_id}</FieldError></Field>
        {shortfall && <p role="alert" className="text-sm text-destructive">{shortfall.message}</p>}
        {mode !== "post" && plan?.schedule_id && <Field><FieldLabel htmlFor="plan-association">Reminder association (this occurrence only)</FieldLabel><NativeSelect id="plan-association" className="w-full" value={association} disabled={planning.busy || reminders.loading} onChange={event => setAssociation(event.target.value)}><NativeSelectOption value="">Not associated</NativeSelectOption>{reminders.obligations.filter(row => row.kind === (type === "expense" ? "debt" : "receivable")).map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}</NativeSelect>{reminders.hasMore && <Button type="button" variant="outline" disabled={reminders.loading || planning.busy} onClick={reminders.loadMore}>Load more obligations</Button>}<FieldDescription>Changing this applies only to this occurrence; the schedule keeps its own association for future occurrences.</FieldDescription></Field>}
        {mode === "post" ? <Field data-invalid={!!errors.transaction_date}><FieldLabel htmlFor="plan-transaction_date">{type === "income" ? "Date received" : "Date paid"}</FieldLabel><FinanceDateInput id="plan-transaction_date" min="1000-01-01" max="9999-12-31" value={date} disabled={planning.busy || cashSource === "existing" && !!cashPick} onChange={setDate} {...invalid("transaction_date")} /><FieldDescription>{linked ? "The day the principal moved. The obligation payment and plan update together." : "Defaults to today. The scheduled due date stays unchanged."}</FieldDescription><FieldError id="plan-error-transaction_date">{errors.transaction_date}</FieldError></Field> : <>
          <Field data-invalid={!!errors.due_date}><FieldLabel htmlFor="plan-due_date">Due date</FieldLabel><FinanceDateInput id="plan-due_date" min="1000-01-01" max="9999-12-31" value={dueDate} disabled={planning.busy} onChange={setDueDate} {...invalid("due_date")} /><FieldDescription>When you expect the activity, not a posting date.</FieldDescription><FieldError id="plan-error-due_date">{errors.due_date}</FieldError></Field>
          <FinancePlanCategories activity={activity} type={type} value={category} onChange={changeCategory} subcategoryId={subcategory} onSubcategoryChange={setSubcategory} disabled={planning.busy} id="plan-category" />
          <Field><FieldLabel htmlFor="plan-text">Plan name (optional)</FieldLabel><Input id="plan-text" maxLength={2000} value={text} disabled={planning.busy} onChange={event => setText(event.target.value)} /></Field>
        </>}
        {mode === "post" && linked && <FieldGroup className="rounded-xl border border-border p-3">
          <details className="text-sm" open={cashSource === "existing" || !!feeAmount ? true : undefined}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Fee or recorded cash (advanced)</summary>
            <FieldGroup className="mt-2">
              {!cashPick && <FieldSet>
                <FieldLegend>Separate interest or fee (optional)</FieldLegend>
                <FieldDescription>Posted as its own linked activity next to the principal payment. Leave the amount blank to skip.</FieldDescription>
                <Field><FieldLabel htmlFor="plan-fee-type">Fee type</FieldLabel><NativeSelect id="plan-fee-type" className="w-full" value={feeType} disabled={planning.busy} onChange={event => changeFeeType(event.target.value)}><NativeSelectOption value="expense">Expense</NativeSelectOption><NativeSelectOption value="income">Income</NativeSelectOption></NativeSelect></Field>
                <Field data-invalid={!!errors.fee}><FieldLabel htmlFor="plan-fee-amount">Fee amount (PHP)</FieldLabel><MoneyInput id="plan-fee-amount" inputMode="decimal" value={feeAmount} disabled={planning.busy} onValueChange={value => setFeeAmount(value)} {...invalid("fee")} /><FieldError id="plan-error-fee">{errors.fee}</FieldError></Field>
                <Field><FieldLabel htmlFor="plan-fee-category">Fee category</FieldLabel><NativeSelect id="plan-fee-category" className="w-full" value={feeCategoryId} disabled={planning.busy} onChange={event => changeFeeCategory(event.target.value)}><NativeSelectOption value="">Uncategorized</NativeSelectOption>{feeCategories.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}</NativeSelect></Field>
                {!!feeSubcategories.length && <Field><FieldLabel htmlFor="plan-fee-subcategory">Fee subcategory</FieldLabel><NativeSelect id="plan-fee-subcategory" className="w-full" value={feeSubcategoryId} disabled={planning.busy} onChange={event => setFeeSubcategoryId(event.target.value)}><NativeSelectOption value="">No subcategory</NativeSelectOption>{feeSubcategories.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}</NativeSelect></Field>}
              </FieldSet>}
              <FieldSet>
                <FieldLegend>Cash effect</FieldLegend>
                <FieldDescription>{cashPick ? "Cash was already recorded; no new cash moves and a separate fee cannot be added." : "Post new cash activity, or link cash already recorded for this payment."}</FieldDescription>
                <RadioGroup name="plan-cash-source" value={cashSource} disabled={planning.busy} onValueChange={value => chooseCashSource(value === "existing" ? "existing" : "new")} aria-label="Cash effect source">
                  <label className="flex min-h-7 items-center gap-2 text-xs"><RadioGroupItem value="new" />Post new cash activity</label>
                  <label className="flex min-h-7 items-center gap-2 text-xs"><RadioGroupItem value="existing" />Link already recorded activity</label>
                </RadioGroup>
                {cashSource === "existing" && <section aria-label="Link existing cash activity" className="flex flex-col gap-3">
                  {cashError ? <Alert><AlertDescription>{cashError}<Button type="button" variant="outline" onClick={retryCash}>Retry payment activity</Button></AlertDescription></Alert>
                    : cashLoading || !cashPage ? <p role="status">Loading payment activity…</p>
                      : cashPage?.transactions.length ? <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">Choose one transaction</legend><RadioGroup aria-label="Choose one transaction" name="plan-cash-activity" value={cashPick?.id ?? ""} disabled={planning.busy} onValueChange={value => { const row = cashPage.transactions.find(row => row.id === value); if (row) selectCash(row); }}>
                        {cashPage.transactions.map(row => <label key={row.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
                          <RadioGroupItem value={row.id} className="mt-1" />
                          <span className="min-w-0 break-words"><strong className="tabular-nums">{money(row.amount_cents)}</strong> · {row.transaction_date}<span className="block">{row.account_name} · {row.category_name ?? "Uncategorized"}</span>{row.text && <span className="mt-1 block text-muted-foreground">{row.text}</span>}</span>
                        </label>)}
                      </RadioGroup></fieldset>
                        : <p className="text-sm text-muted-foreground">No eligible recorded activity. Post new cash activity instead.</p>}
                  {cashPage && cashPage.total > 25 && <nav aria-label="Payment activity pages" className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={!cashOffset || planning.busy} onClick={() => setCashOffset(Math.max(0, cashOffset - 25))}>Previous payments</Button><span className="text-sm">{cashOffset + 1}-{Math.min(cashOffset + 25, cashPage.total)} of {cashPage.total}</span><Button type="button" variant="outline" disabled={cashOffset + 25 >= cashPage.total || planning.busy} onClick={() => setCashOffset(cashOffset + 25)}>Next payments</Button></nav>}
                  {cashPick && <p className="text-sm">Link {money(cashPick.amount_cents)} on {cashPick.transaction_date}. Cash stays as recorded; the payment progress alone is new.</p>}
                  <Button type="button" variant="outline" className="self-start" disabled={!cashPick || planning.busy} onClick={clearCash}>Clear selection</Button>
                </section>}
              </FieldSet>
            </FieldGroup>
          </details>
        </FieldGroup>}
      </FieldGroup>
      <FinanceOptionStatus activity={activity} />
      {mode === "post" && <p className="text-sm text-muted-foreground">{linked ? "Confirming records the principal payment, updates obligation progress and satisfies this occurrence. If already recorded, link it above or use Match activity instead." : "Confirming changes the selected account balance once. If already recorded, use Match activity instead."}</p>}
      <div className="flex flex-wrap justify-end gap-2">{!plan && <Button type="submit" name="another" variant="outline" disabled={planning.busy}>Save and add another plan</Button>}<Button type="submit" disabled={planning.busy || !!shortfall || mode === "post" && linked && (!!reviewError || !reviewObligation || reviewObligation.outstanding_cents <= 0 || cashSource === "existing" && !cashPick)}>{planning.busy ? "Saving…" : mode === "post" ? linked || type === "expense" ? "Confirm payment" : "Confirm income" : plan ? "Save plan changes" : "Save plan"}</Button></div>
    </form>)}
    {planning.saveError && <Alert><AlertDescription>{planning.saveError} Retry unchanged fields for a safe request retry.{plan && <Button variant="outline" disabled={planning.busy} onClick={onRefresh}>Refresh plan before editing</Button>}</AlertDescription></Alert>}
    {(!plan || inline) && <div className={inline ? "mt-auto flex justify-end" : financeDrawerFooter}><Button variant="outline" disabled={planning.busy} onClick={onClose}>Cancel</Button></div>}
  </div>;
}
