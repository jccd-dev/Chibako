"use client";

import { useEffect, useMemo, useState } from "react";
import type { NoteSummary } from "@/lib/notes";
import { dateToNoteDate, datedNotes, noteDateToDate } from "@/features/calendar/note-dates";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

  useEffect(() => setMonth(selectedDate), [selected]);

  return (
    <Calendar
      mode="single"
      month={month}
      onMonthChange={setMonth}
      selected={selectedDate}
      onSelect={(date) => {
        if (!date) return;
        setMonth(date);
        onSelect(dateToNoteDate(date));
      }}
      className={cn(
        "w-full rounded-lg border",
        compact ? "p-1 [--cell-size:1.75rem]" : "p-4 [--cell-size:clamp(2.5rem,7vw,5rem)]"
      )}
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
              aria-label={`${dateLabel}${count ? `, ${count} Note${count === 1 ? "" : "s"}` : ""}`}
            >
              <span>{day.date.getDate()}</span>
              {count > 0 && (
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
