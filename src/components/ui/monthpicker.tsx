"use client";

import * as React from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

// Adapted from the greenk monthpicker registry to this project's Base UI
// button primitives and tabler icons; year navigation is bounded by min/max
// and the four-digit finance year range.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Finance dates stay within the four-digit year boundary.
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

interface MonthPickerProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: Date;
  min?: Date;
  max?: Date;
  onMonthSelect?: (date: Date) => void;
  yearLabel?: (year: number) => string;
}

function monthDisabled(month: number, year: number, min?: Date, max?: Date) {
  return Boolean(
    min && (year < min.getFullYear() || (year === min.getFullYear() && month < min.getMonth())) ||
    max && (year > max.getFullYear() || (year === max.getFullYear() && month > max.getMonth())),
  );
}

export function MonthPicker({ selected, min, max, onMonthSelect, yearLabel, className, ...props }: MonthPickerProps) {
  const [year, setYear] = React.useState(selected?.getFullYear() ?? new Date().getFullYear());
  const sameYear = selected && selected.getFullYear() === year;
  return (
    <div className={cn("grid w-[17rem] gap-3 p-3", className)} {...props}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous year"
          disabled={year <= (min?.getFullYear() ?? MIN_YEAR)}
          onClick={() => setYear(current => current - 1)}
          className={cn(buttonVariants({ variant: "ghost" }), "size-7 p-0 text-muted-foreground aria-disabled:opacity-50")}
        >
          <IconChevronLeft aria-hidden="true" />
        </button>
        <p className="text-sm font-medium tabular-nums">{yearLabel ? yearLabel(year) : year}</p>
        <button
          type="button"
          aria-label="Next year"
          disabled={year >= (max?.getFullYear() ?? MAX_YEAR)}
          onClick={() => setYear(current => current + 1)}
          className={cn(buttonVariants({ variant: "ghost" }), "size-7 p-0 text-muted-foreground aria-disabled:opacity-50")}
        >
          <IconChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {MONTHS.map((name, month) => {
          const isSelected = Boolean(sameYear && selected?.getMonth() === month);
          return (
            <button
              key={month}
              type="button"
              aria-pressed={isSelected}
              disabled={monthDisabled(month, year, min, max)}
              onClick={() => onMonthSelect?.(new Date(year, month, 1))}
              className={cn(buttonVariants({ variant: isSelected ? "default" : "ghost" }), "w-full font-normal aria-disabled:opacity-50")}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
