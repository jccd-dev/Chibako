"use client";

import { Switch } from "@base-ui/react/switch";
import { Field, FieldContent, FieldLabel, FieldDescription } from "@/components/ui/field";

export function FinancePlanToggle({ id, label, description, checked, onChange, disabled }: {
  id: string; label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean;
}) {
  return <Field orientation="horizontal" className="rounded-xl bg-muted/50 p-4">
    <FieldContent><FieldLabel id={`${id}-label`} htmlFor={id}>{label}</FieldLabel>{description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}</FieldContent>
    <Switch.Root id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-labelledby={`${id}-label`} aria-describedby={description ? `${id}-description` : undefined} className="group inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-input p-1 outline-none transition-colors data-checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50">
      <Switch.Thumb className="block size-5 rounded-full bg-primary-foreground transition-transform group-data-checked:translate-x-5 motion-reduce:transition-none" />
    </Switch.Root>
  </Field>;
}
