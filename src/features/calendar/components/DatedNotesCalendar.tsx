"use client";

import { useMemo, useState } from "react";
import type { NoteSummary } from "@/lib/notes";
import { getDefaultClassNames } from "react-day-picker";
import { dateToNoteDate, datedNotes, noteDateToDate } from "@/features/calendar/note-dates";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const defaultClassNames = getDefaultClassNames();

export function DatedNotesCalendar({ notes, selected, onSelect, compact = false }: {
  notes: NoteSummary[];
  selected: string;
  onSelect: (date: string) => void;
  compact?: boolean;
}) {
  const selectedDate = noteDateToDate(selected);
  const [month, setMonth] = useState(selectedDate);
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const note of datedNotes(notes)) next.set(note.date, (next.get(note.date) ?? 0) + 1);
    return next;
  }, [notes]);

  const [previousSelected, setPreviousSelected] = useState(selected);
  if (previousSelected !== selected) {
    setPreviousSelected(selected);
    setMonth(selectedDate);
  }

  // Full-bleed month grid: columns share the pane width, week tracks share the
  // pane height, hairlines draw the cell structure, dates anchor top-left.
  const stretchClassNames = compact ? undefined : {
    months: cn(defaultClassNames.months, "relative h-full w-full flex flex-col"),
    month: cn(defaultClassNames.month, "flex h-full w-full flex-col gap-2"),
    month_caption: cn(defaultClassNames.month_caption, "flex h-10 w-full shrink-0 items-center justify-center px-(--cell-size)"),
    button_previous: cn(buttonVariants({ variant: "ghost" }), "size-9 p-0 select-none aria-disabled:opacity-50", defaultClassNames.button_previous),
    button_next: cn(buttonVariants({ variant: "ghost" }), "size-9 p-0 select-none aria-disabled:opacity-50", defaultClassNames.button_next),
    month_grid: cn(defaultClassNames.month_grid, "flex min-h-0 w-full flex-1 flex-col"),
    weeks: cn(defaultClassNames.weeks, "flex min-h-0 w-full flex-1 flex-col"),
    weekdays: cn(defaultClassNames.weekdays, "flex w-full border-b border-border pb-1"),
    weekday: cn(defaultClassNames.weekday, "min-w-0 flex-1 text-center text-xs font-medium"),
    week: cn(defaultClassNames.week, "flex min-h-(--cell-size) w-full flex-1"),
    day: cn(defaultClassNames.day, "relative isolate flex-1 min-h-0 min-w-0 border-b border-r border-border first:border-l"),
  };

  return (
    <Calendar
      mode="single"
      fixedWeeks={!compact}
      month={month}
      onMonthChange={setMonth}
      selected={selectedDate}
      onSelect={(date) => {
        if (!date) return;
        setMonth(date);
        onSelect(dateToNoteDate(date));
      }}
      className={cn(
        compact
          ? "w-full rounded-lg border p-1 [--cell-size:1.75rem]"
          : "mx-auto h-full w-full max-w-6xl p-0 [--cell-radius:0] [--cell-size:clamp(2.75rem,min(6.5vw,7vh),4.5rem)]"
      )}
      classNames={stretchClassNames}
      components={{
        DayButton: ({ day, modifiers, ...props }) => {
          const date = dateToNoteDate(day.date);
          const count = counts.get(date) ?? 0;
          const dateLabel = day.date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          });
          return (
            <CalendarDayButton
              day={day}
              modifiers={modifiers}
              {...props}
              className={cn(
                props.className,
                compact
                  ? undefined
                  : "aspect-auto h-full rounded-none p-1.5 sm:p-2 [&>span:first-child]:text-sm! [&>span:first-child]:opacity-100!",
              )}
              aria-label={`${dateLabel}${count ? `, ${count} Note${count === 1 ? "" : "s"}` : ""}`}
            >
              <span>{day.date.getDate()}</span>
              {!compact && count > 0 && (
                <Badge variant={modifiers.selected ? "secondary" : "outline"} className="h-4 min-w-4 px-1" aria-hidden="true">
                  {count > 99 ? "99+" : count}
                </Badge>
              )}
            </CalendarDayButton>
          );
        },
      }}
    />
  );
}
