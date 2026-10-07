"use client";

import { useMemo, useState, type ComponentPropsWithoutRef } from "react";
import { format, isValid, parse } from "date-fns";
import { IconCalendar } from "@tabler/icons-react";
import type { Matcher } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { MonthPicker } from "@/components/ui/monthpicker";
import { Button } from "@/components/ui/button";
import { financeControl as control } from "@/features/finance/presentation";
import { cn } from "cn";

// Shared finance date controls for site forms. The popover trigger keeps the
// id, labels and error wiring; a hidden native input keeps required and range
// validation working, because the trigger itself is a button and buttons are
// skipped by native form validation.

type FinanceControlProps = Omit<ComponentPropsWithoutRef<"button">, "onChange" | "value" | "type"> & {
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
};

function isoDate(value: string, template: string) {
  return value.match(/^\d/) ? parse(value, template, new Date()) : undefined;
}

function ValidationInput({ type, value, min, max, required, disabled, name, onChange }: FinanceControlProps & { type: "date" | "month" }) {
  if (!required) return null;
  return <input type={type} className="sr-only top-0 left-0" tabIndex={-1} value={value} onChange={event => onChange(event.target.value)} required disabled={disabled} name={name} min={min} max={max} aria-hidden="true" />;
}

function triggerClasses(valid: boolean, hasValue: boolean, className?: string) {
  return cn(control, "flex items-center justify-between gap-2 pl-3 pr-2 text-left font-normal", valid || hasValue ? "" : "text-muted-foreground", className);
}

export function FinanceDateInput({ value, onChange, min, max, placeholder = "Choose a date", required, className, ...props }: FinanceControlProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => value ? isoDate(value, "yyyy-MM-dd") : undefined, [value]);
  const valid = selected !== undefined && isValid(selected);
  const minDate = min ? isoDate(min, "yyyy-MM-dd") : undefined;
  const maxDate = max ? isoDate(max, "yyyy-MM-dd") : undefined;
  const matchers: Matcher[] = [];
  if (minDate) matchers.push({ before: minDate });
  if (maxDate) matchers.push({ after: maxDate });
  return (
    <>
      <ValidationInput type="date" value={value} min={min} max={max} required={required} disabled={props.disabled} name={props.name} onChange={onChange} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={props.disabled}
              className={triggerClasses(valid, Boolean(value), className)}
              {...props}
            />
          }
        >
          {valid ? format(selected, "MMM d, yyyy") : value || placeholder}
          <IconCalendar aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={valid ? selected : undefined}
            defaultMonth={valid ? selected : undefined}
            onSelect={day => { if (day) { onChange(format(day, "yyyy-MM-dd")); setOpen(false); } }}
            disabled={matchers.length ? matchers : undefined}
            captionLayout="dropdown-months"
            startMonth={minDate ?? new Date(1000, 0, 1)}
            endMonth={maxDate ?? new Date(9999, 11, 31)}
          />
          {value && !required && <div className="border-t border-border p-2"><Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onChange(""); setOpen(false); }}>Clear date</Button></div>}
        </PopoverContent>
      </Popover>
    </>
  );
}

export function FinanceMonthInput({ value, onChange, min, max, placeholder = "Choose a month", required, className, ...props }: FinanceControlProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => value ? isoDate(value, "yyyy-MM") : undefined, [value]);
  const valid = selected !== undefined && isValid(selected);
  return (
    <>
      <ValidationInput type="month" value={value} min={min} max={max} required={required} disabled={props.disabled} name={props.name} onChange={onChange} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={props.disabled}
              className={triggerClasses(valid, Boolean(value), className)}
              {...props}
            />
          }
        >
          {valid ? format(selected, "MMMM yyyy") : value || placeholder}
          <IconCalendar aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <MonthPicker
            selected={valid ? selected : undefined}
            min={min ? isoDate(min, "yyyy-MM") : undefined}
            max={max ? isoDate(max, "yyyy-MM") : undefined}
            onMonthSelect={month => { onChange(format(month, "yyyy-MM")); setOpen(false); }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
