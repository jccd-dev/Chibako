"use client";

import { useEffect, useState } from "react";
import { IconFilter } from "@tabler/icons-react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { FinanceDateInput } from "./FinanceDateInputs";
import type { ActivityFilters, FinanceActivityController } from "@/features/finance/use-finance-activity";

export function FinanceHistoryFilters({ activity }: { activity: FinanceActivityController }) {
  const [draft, setDraft] = useState<ActivityFilters>(activity.filters);
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setDraft(activity.filters); }, [activity.filters]);
  useEffect(() => {
    const media = matchMedia("(min-width: 1024px)");
    const update = () => { setDesktop(media.matches); setOpen(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function change(key: keyof ActivityFilters, value: string) {
    if (key === "hidden" || key === "reverted") {
      if (value === "false" || value === "true" || value === "all") setDraft(current => ({ ...current, [key]: value }));
    } else setDraft(current => ({ ...current, [key]: value }));
  }
  const form = (
    <form onSubmit={event => { event.preventDefault(); activity.applyFilters(draft); setOpen(false); }} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Field><FieldLabel htmlFor="activity-search">Search history</FieldLabel><Input id="activity-search" value={draft.q} maxLength={200} onChange={event => change("q", event.target.value)} /><FieldDescription>Search transaction text, categories and tags.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="activity-account">Filter account</FieldLabel><NativeSelect id="activity-account" className="w-full" value={draft.account_id} onChange={event => change("account_id", event.target.value)}><NativeSelectOption value="">All accounts</NativeSelectOption>{activity.accounts.map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name}{account.archived ? " (archived)" : ""}</NativeSelectOption>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="activity-type">Filter type</FieldLabel><NativeSelect id="activity-type" className="w-full" value={draft.type} onChange={event => change("type", event.target.value)}><NativeSelectOption value="">All activity</NativeSelectOption><NativeSelectOption value="expense">Expense</NativeSelectOption><NativeSelectOption value="income">Income</NativeSelectOption><NativeSelectOption value="transfer">Transfer</NativeSelectOption><NativeSelectOption value="reconciliation">Reconciliation</NativeSelectOption><NativeSelectOption value="valuation">Asset valuation</NativeSelectOption><NativeSelectOption value="refund">Refund</NativeSelectOption><NativeSelectOption value="borrowing">Borrowing</NativeSelectOption><NativeSelectOption value="lending">Lending</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="activity-from">From date</FieldLabel><FinanceDateInput id="activity-from" min="1000-01-01" max="9999-12-31" value={draft.date_from} onChange={value => change("date_from", value)} /></Field>
        <Field><FieldLabel htmlFor="activity-to">To date</FieldLabel><FinanceDateInput id="activity-to" min={draft.date_from || "1000-01-01"} max="9999-12-31" value={draft.date_to} onChange={value => change("date_to", value)} /></Field>
        <Field><FieldLabel htmlFor="activity-category">Filter category</FieldLabel><NativeSelect id="activity-category" className="w-full" value={draft.category_id} onChange={event => change("category_id", event.target.value)}><NativeSelectOption value="">All categories</NativeSelectOption>{activity.classifications.filter(item => item.kind === "category" && (!draft.type || item.type === (draft.type === "refund" ? "expense" : draft.type))).map(item => <NativeSelectOption key={item.id} value={item.id}>{item.type === "income" ? "Income" : "Expense"}: {item.name}{item.parent_id ? " (subcategory)" : ""}{item.archived ? " (archived)" : ""}</NativeSelectOption>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="activity-hidden">Hidden records</FieldLabel><NativeSelect id="activity-hidden" className="w-full" value={draft.hidden} onChange={event => change("hidden", event.target.value)}><NativeSelectOption value="false">Visible only</NativeSelectOption><NativeSelectOption value="true">Hidden only</NativeSelectOption><NativeSelectOption value="all">Visible and hidden</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="activity-reverted">Reverted records</FieldLabel><NativeSelect id="activity-reverted" className="w-full" value={draft.reverted} onChange={event => change("reverted", event.target.value)}><NativeSelectOption value="false">Active effects only</NativeSelectOption><NativeSelectOption value="true">Reverted only</NativeSelectOption><NativeSelectOption value="all">Active and reverted</NativeSelectOption></NativeSelect></Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-3"><Button type="submit">Apply filters</Button><Button type="button" variant="outline" onClick={() => { activity.clearFilters(); setOpen(false); }}>Clear filters</Button></div>
    </form>
  );

  if (desktop) return (
    <aside aria-label="History filters" className="min-w-0 border-r border-border pr-6">
      <h3 className="mb-4 text-sm font-semibold">Filters</h3>
      {form}
    </aside>
  );
  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="outline" />}>
          <IconFilter data-icon="inline-start" aria-hidden="true" />
          Filters
        </SheetTrigger>
        <SheetContent side="left" className="data-[side=left]:w-full overflow-y-auto gap-0 p-0 text-sm motion-reduce:transition-none">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle>History filters</SheetTitle>
            <SheetDescription>Choose which transactions to show.</SheetDescription>
          </SheetHeader>
          <div className="p-4">{form}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
