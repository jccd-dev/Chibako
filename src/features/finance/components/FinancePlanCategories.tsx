"use client";

import { useState } from "react";
import { IconCategory, IconPlus } from "@tabler/icons-react";
import type { FinanceActivityController } from "../use-finance-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// UI-only sentinel: ToggleGroupItem rejects an empty value (useBaseUiId substitutes an internal id), while the API category value for uncategorized is "".
const UNCATEGORIZED = "uncategorized";

export function FinancePlanCategories({
  activity,
  type,
  value,
  onChange,
  disabled,
  id,
  subcategoryId,
  onSubcategoryChange,
}: {
  activity: FinanceActivityController;
  type: "income" | "expense";
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  id: string;
  subcategoryId?: string;
  onSubcategoryChange?: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const categories = activity.classifications.filter(
    (row) =>
      row.kind === "category" &&
      row.type === type &&
      !row.parent_id &&
      (!row.archived || row.id === value),
  );
  const subcategories = onSubcategoryChange
    ? activity.classifications.filter(
        (row) =>
          row.parent_id === value &&
          (!row.archived || row.id === subcategoryId),
      )
    : [];
  async function addCategory() {
    if (!name.trim()) {
      setError("Enter a category name.");
      return;
    }
    const result = await activity.saveClassification(null, {
      kind: "category",
      type,
      name: name.trim(),
    });
    if (result) {
      onChange(result.classification.id);
      setAdding(false);
      setName("");
      setError("");
    }
  }
  return (
    <Field>
      <FieldLabel id={`${id}-label`}>Category</FieldLabel>
      <ToggleGroup
        id={id}
        aria-labelledby={`${id}-label`}
        value={[value || UNCATEGORIZED]}
        disabled={disabled || activity.busy}
        onValueChange={(values) => {
          onChange(values.find((v) => v !== UNCATEGORIZED) ?? "");
          onSubcategoryChange?.("");
        }}
        variant="outline"
        spacing={1}
        className="w-full flex-wrap justify-start"
      >
        <ToggleGroupItem value={UNCATEGORIZED} className="px-2">
          Uncategorized
        </ToggleGroupItem>
        {categories.map((row) => (
          <ToggleGroupItem
            key={row.id}
            value={row.id}
            className="h-auto min-h-7 max-w-full gap-1.5 px-2 py-1 whitespace-normal text-left"
          >
            <IconCategory aria-hidden="true" />
            {row.name}
            {row.archived ? " (archived)" : ""}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {onSubcategoryChange && value && subcategories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel id={`${id}-subcategory-label`}>Subcategories</FieldLabel>
          <ToggleGroup
            id={`${id}-subcategory`}
            aria-labelledby={`${id}-subcategory-label`}
            value={subcategoryId ? [subcategoryId] : []}
            disabled={disabled || activity.busy}
            onValueChange={(values) => onSubcategoryChange?.(values[0] ?? "")}
            variant="outline"
            spacing={1}
            className="w-full flex-wrap justify-start"
          >
            {subcategories.map((row) => (
              <ToggleGroupItem
                key={row.id}
                value={row.id}
                className="h-auto min-h-7 max-w-full gap-1.5 px-2 py-1 whitespace-normal text-left"
              >
                {row.name}
                {row.archived ? " (archived)" : ""}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      {!adding ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={disabled || activity.busy}
          onClick={() => {
            setAdding(true);
            activity.resetSave();
          }}
        >
          <IconPlus aria-hidden="true" />
          Add category
        </Button>
      ) : (
        <Field>
          <FieldLabel htmlFor={`${id}-new`}>New {type} category</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${id}-new`}
              maxLength={120}
              value={name}
              disabled={disabled || activity.busy}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addCategory();
                }
              }}
              className="min-w-0 flex-1 basis-40"
            />
            <Button
              type="button"
              disabled={disabled || activity.busy}
              onClick={() => void addCategory()}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={activity.busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
          <FieldError>{error || activity.saveError}</FieldError>
        </Field>
      )}
    </Field>
  );
}
