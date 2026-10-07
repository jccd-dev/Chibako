"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceClassification } from "@/features/finance/activity-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { financeControl as control, financeSelect as select, financeSheet } from "@/features/finance/presentation";
import { FinanceOptionStatus } from "./FinanceActivity";

export function FinanceClassifications({ activity }: { activity: FinanceActivityController }) {
  const [panel, setPanel] = useState<FinanceClassification | "create" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("expense");
  const [parentId, setParentId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const editing = typeof panel === "object" ? panel : null;
  function open(item?: FinanceClassification) {
    activity.resetSave(); setPanel(item ?? "create"); setName(item?.name ?? ""); setKind(item?.kind === "tag" ? "tag" : item?.type ?? "expense"); setParentId(item?.parent_id ?? "");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await activity.saveClassification(editing?.id ?? null, editing ? { name, version: editing.version } : {
      kind: kind === "tag" ? "tag" : "category", ...(kind === "tag" ? {} : { type: kind }), name, parent_id: kind === "tag" ? null : parentId || null,
    });
    if (result) setPanel(null);
  }
  async function archive() {
    if (editing && await activity.saveClassification(editing.id, { version: editing.version, archived: !editing.archived })) setPanel(null);
  }
  const visible = activity.classifications.filter(item => showArchived || !item.archived);
  return <section className="mt-8 border-t border-border pt-6" aria-label="Categories and tags">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Categories and tags</h2><p className="mt-1 text-sm text-muted-foreground">Income and expense categories stay separate. Subcategories have one parent.</p></div><Button className={control} onClick={() => open()}>Add category or tag</Button></div>
    <label className="my-5 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived classifications</label>
    <FinanceOptionStatus activity={activity} />
    {visible.length ? <ul className="divide-y divide-border">{visible.map(item => <li key={item.id} className="flex min-w-0 items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.name}</p><p className="mt-1 text-sm text-muted-foreground">{item.kind === "tag" ? "Tag" : `${item.type === "income" ? "Income" : "Expense"} ${item.parent_id ? "subcategory" : "category"}`}{item.parent_id ? ` in ${activity.classifications.find(parent => parent.id === item.parent_id)?.name ?? "saved category"}` : ""}{item.archived ? " (archived)" : ""}</p></div><Button variant="ghost" className={control} aria-label={`Manage classification ${item.name}`} onClick={() => open(item)}>Manage</Button></li>)}</ul> : <p className="py-6 text-sm text-muted-foreground">No categories or tags yet. Transactions can use Uncategorized.</p>}
    <p className="mt-5 text-sm text-muted-foreground">Tarsi import is not available in this preview.</p>
    <Sheet open={panel !== null} onOpenChange={value => { if (!value && !activity.busy) setPanel(null); }}>
      <SheetContent className={financeSheet} showCloseButton={false}>
        <SheetHeader className="border-b border-border p-6"><SheetTitle>{editing ? "Manage classification" : "Add category or tag"}</SheetTitle><SheetDescription>{editing ? "Rename or archive without removing posted history." : "Create a category, optional subcategory or tag."}</SheetDescription></SheetHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col gap-6 p-6">
          <FieldGroup>
            <Field><FieldLabel htmlFor="classification-name">Classification name</FieldLabel><Input id="classification-name" required maxLength={120} value={name} disabled={activity.busy} onChange={event => setName(event.target.value)} className={control} /></Field>
            <Field><FieldLabel htmlFor="classification-kind">Classification kind</FieldLabel><select id="classification-kind" className={select} value={kind} disabled={!!editing || activity.busy} onChange={event => { setKind(event.target.value); setParentId(""); }}><option value="expense">Expense category</option><option value="income">Income category</option><option value="tag">Tag</option></select><FieldDescription>Type and parent are fixed once created.</FieldDescription></Field>
            {kind !== "tag" && <Field><FieldLabel htmlFor="classification-parent">Parent category</FieldLabel><select id="classification-parent" className={select} value={parentId} disabled={!!editing || activity.busy} onChange={event => setParentId(event.target.value)}><option value="">No parent (top-level category)</option>{activity.classifications.filter(item => item.kind === "category" && item.type === kind && !item.parent_id && (!item.archived || item.id === parentId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><FieldDescription>Choose a parent to create a subcategory.</FieldDescription></Field>}
          </FieldGroup>
          <FinanceOptionStatus activity={activity} />
          {activity.saveError && <Alert><AlertDescription>{activity.saveError} Your entries are kept. Reopen this classification if it has changed.</AlertDescription></Alert>}
          <div className="mt-auto flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={() => setPanel(null)}>Cancel</Button><Button type="submit" className={control} disabled={activity.busy || !name.trim()}>{activity.busy ? "Saving…" : "Save classification"}</Button></div>
          {editing && <div className="border-t border-border pt-5"><p className="mb-3 text-sm text-muted-foreground">Archived classifications remain on existing transactions but cannot classify new entries.</p><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={() => void archive()}>{editing.archived ? "Restore classification" : "Archive classification"}</Button></div>}
        </form>
      </SheetContent>
    </Sheet>
  </section>;
}
