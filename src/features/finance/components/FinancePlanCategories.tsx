"use client";

import { useState } from "react";
import { IconCategory, IconPlus } from "@tabler/icons-react";
import type { FinanceActivityController } from "../use-finance-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function FinancePlanCategories({ activity, type, value, onChange, disabled, id }: {
  activity: FinanceActivityController;
  type: "income" | "expense";
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  id: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const categories = activity.classifications.filter(row => row.kind === "category" && row.type === type && !row.parent_id && (!row.archived || row.id === value));
  const visible = expanded ? categories : categories.filter((row, index) => index < 9 || row.id === value);
  async function addCategory() {
    if (!name.trim()) { setError("Enter a category name."); return; }
    const result = await activity.saveClassification(null, { kind: "category", type, name: name.trim() });
    if (result) { onChange(result.classification.id); setAdding(false); setName(""); setError(""); }
  }
  return <Field>
    <div className="flex items-center justify-between gap-3">
      <FieldLabel id={`${id}-label`}>Category</FieldLabel>
      {categories.length > 9 && <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "View all"}</Button>}
    </div>
    <ToggleGroup id={id} aria-labelledby={`${id}-label`} value={[value]} disabled={disabled || activity.busy} onValueChange={values => onChange(values[0] ?? "")} variant="outline" className="w-full flex-wrap justify-start">
      <ToggleGroupItem value="" className="min-h-11 px-3">Uncategorized</ToggleGroupItem>
      {visible.map(row => <ToggleGroupItem key={row.id} value={row.id} className="min-h-11 max-w-full gap-2 px-3 whitespace-normal text-left"><IconCategory aria-hidden="true" />{row.name}{row.archived ? " (archived)" : ""}</ToggleGroupItem>)}
    </ToggleGroup>
    {!adding ? <Button type="button" variant="outline" className="self-start" disabled={disabled || activity.busy} onClick={() => { setAdding(true); activity.resetSave(); }}><IconPlus aria-hidden="true" />Add category</Button> : <Field>
      <FieldLabel htmlFor={`${id}-new`}>New {type} category</FieldLabel>
      <div className="flex flex-wrap gap-2"><Input id={`${id}-new`} maxLength={120} value={name} disabled={disabled || activity.busy} onChange={event => { setName(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addCategory(); } }} className="min-w-0 flex-1 basis-40" /><Button type="button" disabled={disabled || activity.busy} onClick={() => void addCategory()}>Add</Button><Button type="button" variant="ghost" disabled={activity.busy} onClick={() => setAdding(false)}>Cancel</Button></div>
      <FieldError>{error || activity.saveError}</FieldError>
    </Field>}
  </Field>;
}
