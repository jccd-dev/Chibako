"use client";

import { useState } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { IconSelector } from "@tabler/icons-react";
import { cn } from "cn";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";

const RECENT_KEY = "chibako:recent-folders";
const RECENT_LIMIT = 5;

type FolderGroup = { label: string; items: string[] };

// Recents are a per-browser convenience shared by every picker; storage may be unavailable.
function readRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((folder): folder is string => typeof folder === "string") : [];
  } catch {
    return [];
  }
}

function rememberFolder(folder: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([folder, ...readRecent().filter((f) => f !== folder)].slice(0, RECENT_LIMIT)));
  } catch {
    // Without storage the picker still works; it just has no recents.
  }
}

/** Searchable folder select: "" is the empty choice, typing matches anywhere in the path, recent picks come first. */
export function FolderPicker({ folders, value, onChange, emptyLabel, id, "aria-label": ariaLabel, className }: {
  folders: string[];
  value: string;
  onChange: (folder: string) => void;
  emptyLabel: string;
  id?: string;
  "aria-label": string;
  className?: string;
}) {
  const [recent, setRecent] = useState<string[]>([]);
  const shownRecent = recent.filter((folder) => folders.includes(folder));
  const groups: FolderGroup[] = [
    { label: "", items: [""] },
    { label: "Recent", items: shownRecent },
    { label: "Folders", items: folders.filter((folder) => folder && !shownRecent.includes(folder)) },
  ].filter((group) => group.items.length);

  return (
    <Combobox
      items={groups}
      value={value}
      itemToStringLabel={(folder: string) => folder || emptyLabel}
      onOpenChange={(open) => { if (open) setRecent(readRecent()); }}
      onValueChange={(next: string | null) => {
        if (next === null) return;
        if (next) rememberFolder(next);
        onChange(next);
      }}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "flex h-7 max-w-64 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/20 py-0.5 pr-1.5 pl-2 text-left text-xs/relaxed outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <span className="truncate">{value || emptyLabel}</span>
        <IconSelector className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className="min-w-64">
        <ComboboxInput showTrigger={false} placeholder="Search folders" aria-label="Search folders" />
        <ComboboxEmpty>No folders found</ComboboxEmpty>
        <ComboboxList>
          {(group: FolderGroup) => (
            <ComboboxGroup key={group.label || "none"} items={group.items}>
              {group.label && <ComboboxLabel>{group.label}</ComboboxLabel>}
              <ComboboxCollection>
                {(folder: string) => <ComboboxItem key={folder} value={folder}>{folder || emptyLabel}</ComboboxItem>}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
