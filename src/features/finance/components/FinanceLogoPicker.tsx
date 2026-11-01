"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AccountLogo } from "./AccountLogo";
import { ACCOUNT_LOGOS } from "../account-logos";

const tile = "relative grid size-11 cursor-pointer place-items-center rounded-md border border-input bg-input/20 text-xs text-muted-foreground hover:bg-muted has-data-checked:border-primary has-data-checked:bg-primary/10 has-data-checked:ring-2 has-data-checked:ring-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:bg-input/30";

export function FinanceLogoPicker({ value, onChange, disabled, name }: {
  value: string;
  onChange: (logo: string) => void;
  disabled?: boolean;
  name: string;
}) {
  return <RadioGroup aria-label="Account logo" value={value} disabled={disabled} className="flex flex-wrap gap-2"
    onValueChange={next => onChange(String(next))}>
    <label className={tile} title="No logo">
      <RadioGroupItem value="" aria-label="No logo" className="absolute size-px opacity-0" />
      <AccountLogo logo="" name={name} className="bg-transparent" />
    </label>
    {ACCOUNT_LOGOS.map(logo => <label key={logo.id} className={tile} title={logo.label}>
      <RadioGroupItem value={logo.id} aria-label={logo.label} className="absolute size-px opacity-0" />
      <AccountLogo logo={logo.id} name={logo.label} />
    </label>)}
  </RadioGroup>;
}
