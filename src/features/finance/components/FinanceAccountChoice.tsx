"use client";

import { IconCheck } from "@tabler/icons-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatPHP } from "@/features/finance/presentation";
import type { FinanceAccount } from "@/features/finance/types";

const none = "__none__";
const pill = "relative flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-input bg-input/20 px-3 py-1.5 text-xs hover:bg-muted has-data-checked:border-primary has-data-checked:bg-primary/10 has-data-checked:text-primary dark:bg-input/30 has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

export function FinanceAccountChoice({ label, accounts, value, onChange, disabled, noneLabel, noneHint }: {
  label: string;
  accounts: readonly FinanceAccount[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  noneLabel?: string;
  noneHint?: string;
}) {
  const selected = value || (noneLabel ? none : "");
  const check = (id: string) => selected === id && <IconCheck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />;
  return <RadioGroup aria-label={label} value={selected} disabled={disabled} className="flex flex-wrap gap-2"
    onValueChange={next => onChange(next === none ? "" : String(next))}>
    {noneLabel && <label className={pill} title={noneHint}>
      <RadioGroupItem value={none} className="absolute size-px opacity-0" />
      {check(none)}<span className="font-medium">{noneLabel}</span>
    </label>}
    {accounts.map(account => <label key={account.id} className={pill}>
      <RadioGroupItem value={account.id} className="absolute size-px opacity-0" />
      {check(account.id)}
      <span className="max-w-40 truncate font-medium">{account.name}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{formatPHP(account.balance_cents)}</span>
    </label>)}
  </RadioGroup>;
}
