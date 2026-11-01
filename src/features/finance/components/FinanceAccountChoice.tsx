"use client";

import { useState } from "react";
import { IconChevronDown, IconChevronUp, IconCircleOff } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatPHP } from "@/features/finance/presentation";
import type { FinanceAccount } from "@/features/finance/types";
import { AccountLogo } from "./AccountLogo";

export type ChoiceAccount = Pick<FinanceAccount, "id" | "name" | "logo" | "balance_cents">;
const none = "__none__";
const VISIBLE = 6;
const tile = "relative flex min-h-9 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1 hover:bg-muted has-data-checked:border-primary has-data-checked:bg-primary/10 has-data-checked:ring-1 has-data-checked:ring-primary dark:bg-input/30 has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

export function FinanceAccountChoice({ label, accounts, value, onChange, disabled, noneLabel, noneHint }: {
  label: string;
  accounts: readonly ChoiceAccount[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  noneLabel?: string;
  noneHint?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const selected = value || (noneLabel ? none : "");
  // A chosen account stays visible while the list is collapsed.
  const visible = expanded ? accounts : accounts.filter((account, index) => index < VISIBLE || account.id === selected);
  const hidden = accounts.length - visible.length;
  return <div className="flex flex-col gap-2">
    <RadioGroup aria-label={label} value={selected} disabled={disabled} className="flex flex-wrap gap-1.5"
      onValueChange={next => onChange(next === none ? "" : String(next))}>
      {noneLabel && <label className={tile} title={noneHint}>
        <RadioGroupItem value={none} className="absolute size-px opacity-0" />
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><IconCircleOff className="size-3.5" /></span>
        <span className="min-w-0 truncate text-[11px] font-medium">{noneLabel}</span>
      </label>}
      {visible.map(account => <label key={account.id} className={tile}>
        <RadioGroupItem value={account.id} className="absolute size-px opacity-0" />
        <AccountLogo logo={account.logo} name={account.name} className="size-6 text-[10px]" />
        <span className="min-w-0 max-w-36">
          <span className="block truncate text-[11px] leading-tight font-medium">{account.name}</span>
          <span className="block truncate text-[10px] leading-tight text-muted-foreground tabular-nums">{formatPHP(account.balance_cents)}</span>
        </span>
      </label>)}
    </RadioGroup>
    {accounts.length > VISIBLE && <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground"
      aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
      {expanded ? <IconChevronUp aria-hidden="true" /> : <IconChevronDown aria-hidden="true" />}
      {expanded ? "Show fewer" : `Show ${hidden} more`}
    </Button>}
  </div>;
}
