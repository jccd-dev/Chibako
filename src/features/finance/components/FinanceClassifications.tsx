"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconCategory } from "@tabler/icons-react";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FinanceClassification } from "@/features/finance/activity-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { useFinanceClassifications } from "@/features/finance/use-finance-classifications";
import {
  financeDrawerFooter,
  financeSheet,
} from "@/features/finance/presentation";
import { FinanceOptionStatus } from "./FinanceActivity";

function ClassificationBadge({
  item,
  count,
  disabled,
  onClick,
}: {
  item: FinanceClassification;
  count?: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={`h-auto min-h-9 min-w-9 gap-2 px-2.5 py-1.5 transition-none disabled:pointer-events-none disabled:opacity-50 ${item.archived ? "border-dashed hover:bg-muted" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`Manage ${item.name}${item.archived ? " (archived)" : ""}`}
    >
      <IconCategory aria-hidden="true" />
      <span className="min-w-0 whitespace-normal text-left text-sm [overflow-wrap:anywhere]">
        {item.name}
        {count !== undefined && count > 0 && (
          <span className="text-muted-foreground"> ({count})</span>
        )}
        {item.archived && (
          <span className="text-muted-foreground"> Archived</span>
        )}
      </span>
    </Button>
  );
}

function SubcategoryEditor({
  inputId,
  label,
  value,
  disabled,
  error,
  saveLabel,
  onChange,
  onSave,
  onCancel,
  archived,
  onToggleArchived,
}: {
  inputId: string;
  label?: string;
  value: string;
  disabled: boolean;
  error?: string;
  saveLabel: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  archived?: boolean;
  onToggleArchived?: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Field>
        {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            required
            maxLength={120}
            value={value}
            disabled={disabled}
            aria-label={label ? undefined : "Subcategory name"}
            autoFocus
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSave();
              }
            }}
            className="min-w-0 flex-1 basis-40"
          />
          <Button
            type="button"
            disabled={disabled || !value.trim()}
            onClick={onSave}
          >
            {saveLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
        <FieldError>{error}</FieldError>
      </Field>
      {onToggleArchived && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={disabled}
          onClick={onToggleArchived}
        >
          {archived ? "Restore" : "Archive"}
        </Button>
      )}
    </div>
  );
}

function BadgeGroup({
  label,
  emptyText,
  children,
}: {
  label: string;
  emptyText: string;
  children?: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <h3 className="text-sm font-medium">{label}</h3>
      {children ?? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

export function FinanceClassifications({
  activity,
}: {
  activity: FinanceActivityController;
}) {
  const model = useFinanceClassifications(activity);
  const { view } = model;
  const manageChildren =
    view.kind === "manage-category" ? model.childrenOf(view.item) : [];
  const sheetTitle =
    view.kind === "create-category"
      ? "Add category"
      : view.kind === "create-tag"
        ? "Add tag"
        : view.kind === "closed"
          ? ""
          : `${view.item.name}${view.item.archived ? " (archived)" : ""}`;
  const sheetDescription =
    view.kind === "create-category"
      ? "Create an expense or income category."
      : view.kind === "create-tag"
        ? "Use tags to add context across income and expenses."
        : view.kind === "manage-category"
          ? "Rename, manage subcategories, or archive without removing posted history."
          : "Rename or archive without removing posted history.";
  const nameLabel =
    view.kind === "create-category"
      ? "Category name"
      : view.kind === "create-tag"
        ? "Tag name"
        : "Name";
  const submitLabel =
    view.kind === "create-category"
      ? "Create category"
      : view.kind === "create-tag"
        ? "Create tag"
        : "Save changes";
  return (
    <section aria-label="Categories and tags" className="flex flex-col gap-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription className="max-sm:col-start-1 max-sm:row-start-2">
            Expense and income categories group separately. Subcategories live
            inside their parent category.
          </CardDescription>
          <CardAction className="max-sm:col-start-1 max-sm:row-start-3">
            <Button size="sm" onClick={model.openCreateCategory}>
              Add category
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex min-h-7 items-center gap-2 text-xs">
            <Checkbox
              checked={model.showArchived}
              onCheckedChange={(checked) => model.setShowArchived(checked)}
            />
            Show archived classifications
          </label>
          <FinanceOptionStatus activity={activity} />
          <div className="flex flex-col gap-6">
            <BadgeGroup
              label="Expenses"
              emptyText={
                model.partial
                  ? "Load more categories and tags to see all categories."
                  : "No expense categories yet."
              }
            >
              {model.visible.expense.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {model.visible.expense.map(({ category, children }) => (
                    <li key={category.id} className="min-w-0 max-w-full">
                      <ClassificationBadge
                        item={category}
                        count={children.length}
                        onClick={() => model.openCategory(category)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </BadgeGroup>
            <BadgeGroup
              label="Income"
              emptyText={
                model.partial
                  ? "Load more categories and tags to see all categories."
                  : "No income categories yet."
              }
            >
              {model.visible.income.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {model.visible.income.map(({ category, children }) => (
                    <li key={category.id} className="min-w-0 max-w-full">
                      <ClassificationBadge
                        item={category}
                        count={children.length}
                        onClick={() => model.openCategory(category)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </BadgeGroup>
            {model.visible.pendingChildren.length ? (
              <div role="group" aria-label="Subcategories awaiting their parent">
                <h3 className="text-sm font-medium">
                  Subcategories awaiting their parent
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Their parent category has not loaded yet. Load more categories
                  and tags to place them.
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {model.visible.pendingChildren.map((item) => (
                    <li key={item.id} className="min-w-0 max-w-full">
                      {model.childDraft?.id === item.id ? (
                        <SubcategoryEditor
                          inputId={`classification-child-${item.id}`}
                          value={model.childDraft.name}
                          disabled={activity.busy}
                          error={activity.saveError || undefined}
                          saveLabel="Save"
                          archived={item.archived}
                          onChange={model.setChildDraftName}
                          onSave={() => void model.saveChild()}
                          onCancel={model.closeChild}
                          onToggleArchived={() =>
                            void model.toggleChildArchived(item)
                          }
                        />
                      ) : (
                        <ClassificationBadge
                          item={item}
                          disabled={
                            activity.busy ||
                            model.dirty ||
                            model.childDraft?.id != null
                          }
                          onClick={() => model.openChildEditor(item)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription className="max-sm:col-start-1 max-sm:row-start-2">
            Use tags to add context across income and expenses.
          </CardDescription>
          <CardAction className="max-sm:col-start-1 max-sm:row-start-3">
            <Button size="sm" variant="outline" onClick={model.openCreateTag}>
              Add tag
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {model.visible.tags.length ? (
            <ul className="flex flex-wrap gap-2">
              {model.visible.tags.map((item) => (
                <li key={item.id} className="min-w-0 max-w-full">
                  <ClassificationBadge
                    item={item}
                    onClick={() => model.openTag(item)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {model.partial
                ? "Load more categories and tags to see all tags."
                : "No tags yet."}
            </p>
          )}
        </CardContent>
      </Card>
      <Sheet
        open={model.sheetOpen}
        onOpenChange={(value) => {
          if (!value) model.close();
        }}
      >
        <SheetContent
          className={`${financeSheet} overscroll-contain`}
          showCloseButton={false}
        >
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle>{sheetTitle}</SheetTitle>
            <SheetDescription>{sheetDescription}</SheetDescription>
          </SheetHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void model.submit();
            }}
            className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0"
          >
            <FieldGroup className="gap-6">
              <Field>
                <FieldLabel htmlFor="classification-name">
                  {nameLabel}
                </FieldLabel>
                <Input
                  id="classification-name"
                  required
                  maxLength={120}
                  value={model.draftName}
                  disabled={activity.busy}
                  onChange={(event) => model.setDraftName(event.target.value)}
                />
              </Field>
              {view.kind === "create-category" && (
                <Field>
                  <FieldLabel htmlFor="classification-type">
                    Category type
                  </FieldLabel>
                  <NativeSelect
                    id="classification-type"
                    className="w-full"
                    value={model.draftType}
                    disabled={activity.busy}
                    onChange={(event) =>
                      model.setDraftType(
                        event.target.value === "income" ? "income" : "expense",
                      )
                    }
                  >
                    <NativeSelectOption value="expense">
                      Expense category
                    </NativeSelectOption>
                    <NativeSelectOption value="income">
                      Income category
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    Type is fixed once created.
                  </FieldDescription>
                </Field>
              )}
            </FieldGroup>
            {activity.saveError && !model.childDraft && (
              <Alert>
                <AlertDescription>
                  {activity.saveError} Your entries are kept. Reopen this
                  classification if it has changed.
                </AlertDescription>
              </Alert>
            )}
            {view.kind === "manage-category" && (
              <div className="border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h3 className="text-sm font-medium">Subcategories</h3>
                  {!view.item.archived && model.childDraft?.id !== null && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={activity.busy || model.dirty}
                      onClick={model.startChildAdd}
                    >
                      Add subcategory
                    </Button>
                  )}
                </div>
                {view.item.archived && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Restore this category to add subcategories. Existing
                    subcategories stay available.
                  </p>
                )}
                {model.dirty && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Save or discard your changes to manage subcategories.
                  </p>
                )}
                {model.childDraft?.id === null && (
                  <div className="mt-3">
                    <SubcategoryEditor
                      label="New subcategory name"
                      inputId="classification-child-new"
                      value={model.childDraft.name}
                      disabled={activity.busy}
                      error={activity.saveError || undefined}
                      saveLabel="Add"
                      onChange={model.setChildDraftName}
                      onSave={() => void model.saveChild()}
                      onCancel={model.closeChild}
                    />
                  </div>
                )}
                {manageChildren.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {manageChildren.map((item) => {
                      const draft =
                        model.childDraft?.id === item.id
                          ? model.childDraft
                          : null;
                      return (
                        <li key={item.id} className="min-w-0 max-w-full">
                          {draft ? (
                            <SubcategoryEditor
                              inputId={`classification-child-${item.id}`}
                              value={draft.name}
                              disabled={activity.busy}
                              error={activity.saveError || undefined}
                              saveLabel="Save"
                              archived={item.archived}
                              onChange={model.setChildDraftName}
                              onSave={() => void model.saveChild()}
                              onCancel={model.closeChild}
                              onToggleArchived={() =>
                                void model.toggleChildArchived(item)
                              }
                            />
                          ) : (
                            <ClassificationBadge
                              item={item}
                              disabled={
                                activity.busy ||
                                model.dirty ||
                                model.childDraft?.id != null
                              }
                              onClick={() => model.openChildEditor(item)}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {model.partial
                      ? "Load more categories and tags to see all subcategories."
                      : "No subcategories yet."}
                  </p>
                )}
                {model.partial && (
                  <div className="mt-3">
                    <FinanceOptionStatus activity={activity} />
                  </div>
                )}
              </div>
            )}
            {(view.kind === "manage-category" ||
              view.kind === "manage-tag") && (
              <div className="border-t border-border pt-5">
                <p className="mb-3 text-sm text-muted-foreground">
                  Archived classifications remain on existing transactions but
                  cannot classify new entries.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={activity.busy || model.dirty}
                  onClick={() => void model.toggleArchived()}
                >
                  {view.item.archived
                    ? "Restore classification"
                    : "Archive classification"}
                </Button>
              </div>
            )}
            <div className={financeDrawerFooter}>
              <Button
                type="button"
                variant="outline"
                disabled={activity.busy}
                onClick={model.close}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={activity.busy || !model.draftName.trim()}
              >
                {activity.busy ? "Saving…" : submitLabel}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}
