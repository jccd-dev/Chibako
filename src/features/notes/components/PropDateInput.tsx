"use client";

import { useState } from "react";
import { format, isValid, parse } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";

export function PropDateInput({ value, onCommit, ariaLabel }: {
  value: string;
  onCommit: (raw: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  // Keep the year dropdown short but always include the stored year.
  const thisYear = new Date().getFullYear();
  const year = selected?.getFullYear() ?? thisYear;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel}
        className="min-w-0 flex-1 truncate rounded text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {selected ? format(selected, "MMM d, yyyy") : value || <span className="text-muted-foreground">—</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(day) => { if (day) { onCommit(format(day, "yyyy-MM-dd")); setOpen(false); } }}
          captionLayout="dropdown"
          startMonth={new Date(Math.min(thisYear - 20, year), 0)}
          endMonth={new Date(Math.max(thisYear + 25, year), 11)}
        />
        {value && (
          <div className="border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onCommit(""); setOpen(false); }}>Clear date</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
