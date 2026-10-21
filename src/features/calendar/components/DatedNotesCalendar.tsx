"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NoteSummary } from "@/lib/notes";
import { getDefaultClassNames } from "react-day-picker";
import { coversDate, dateToNoteDate, datedNotes, noteDateToDate, type DatedNote } from "@/features/calendar/note-dates";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const defaultClassNames = getDefaultClassNames();
const MAX_SPAN_LANES = 3;

/** Greedy lane per multi-day Note so a span keeps one row across the days it covers. */
function spanLanes(notes: DatedNote[]) {
  const lanes: string[] = [];
  return [...notes]
    .filter((note) => note.endDate > note.date)
    .sort((a, b) => a.date.localeCompare(b.date) || b.endDate.localeCompare(a.endDate))
    .map((note) => {
      let lane = lanes.findIndex((end) => end < note.date);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = note.endDate;
      return { note, lane };
    });
}

export function DatedNotesCalendar({ notes, selected, selectedEnd, onSelect, compact = false }: {
  notes: NoteSummary[];
  selected: string;
  /** Inclusive end of the current Note's range, highlighted as a band. */
  selectedEnd?: string;
  onSelect: (date: string) => void;
  compact?: boolean;
}) {
  const selectedDate = noteDateToDate(selected);
  const [month, setMonth] = useState(selectedDate);
  const dated = useMemo(() => datedNotes(notes), [notes]);
  const spans = useMemo(() => compact ? [] : spanLanes(dated), [compact, dated]);
  const band = selectedEnd && selectedEnd > selected
    ? { from: selectedDate, to: noteDateToDate(selectedEnd) }
    : undefined;

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
    day: cn(defaultClassNames.day, "relative flex-1 min-h-0 min-w-0 border-b border-r border-border first:border-l"),
    today: "bg-transparent",
  };

  return (
    <Calendar
      mode="single"
      fixedWeeks={!compact}
      month={month}
      onMonthChange={setMonth}
      selected={selectedDate}
      modifiers={band && { band, bandStart: band.from, bandEnd: band.to }}
      modifiersClassNames={{
        // Square inner corners so the band reads as one continuous span.
        band: "rounded-none! bg-primary/15",
        bandStart: "rounded-l-(--cell-radius)!",
        bandEnd: "rounded-r-(--cell-radius)!",
      }}
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
          const count = dated.filter((note) => coversDate(note, date)).length;
          const daySpans = spans.filter(({ note }) => coversDate(note, date));
          const dateLabel = day.date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          });
          const label = `${dateLabel}${count ? `, ${count} Note${count === 1 ? "" : "s"}` : ""}`;
          if (compact) {
            return <CalendarDayButton day={day} modifiers={modifiers} {...props} aria-label={label}>{day.date.getDate()}</CalendarDayButton>;
          }
          const visible = daySpans.filter(({ lane }) => lane < MAX_SPAN_LANES);
          const hidden = daySpans.length - visible.length;
          const lanes = visible.length ? Math.max(...visible.map(({ lane }) => lane)) + 1 : 0;
          return (
            <>
              <CalendarDayButton
                day={day}
                modifiers={modifiers}
                {...props}
                // The cell stays unfilled when selected so pills remain readable.
                className={cn(
                  props.className,
                  "aspect-auto h-full items-stretch justify-start overflow-hidden rounded-none p-1.5 text-left sm:p-2",
                  "data-[selected-single=true]:bg-transparent data-[selected-single=true]:text-foreground",
                )}
                aria-label={label}
              >
                <span className="flex items-center gap-1.5 text-sm! opacity-100!">
                  <span className={cn(
                    "grid size-6 place-items-center rounded-full tabular-nums",
                    modifiers.today
                      ? "bg-primary font-semibold text-primary-foreground"
                      : modifiers.selected && "ring-1 ring-primary",
                  )}>
                    {day.date.getDate()}
                  </span>
                  {count > 0 && (
                    <Badge variant="outline" className="h-4 min-w-4 px-1 text-[10px]" aria-hidden="true">
                      {count > 99 ? "99+" : count}
                    </Badge>
                  )}
                </span>
              </CalendarDayButton>
              {/* Pills sit beside the day button because links cannot nest inside a button. */}
              <div className="pointer-events-none absolute inset-x-0 top-9 z-20 flex flex-col gap-0.5 sm:top-10">
                {Array.from({ length: lanes }, (_, lane) => {
                  const span = visible.find((entry) => entry.lane === lane);
                  const { note } = span ?? {};
                  // One pill per week row: drawn from its first day in the row, spacers elsewhere keep lanes aligned.
                  if (!note || (note.date !== date && day.date.getDay() !== 0)) return <span key={lane} className="h-4 shrink-0" />;
                  const isStart = note.date === date;
                  const daysToEnd = Math.round((noteDateToDate(note.endDate).getTime() - day.date.getTime()) / 86_400_000) + 1;
                  const daysLeftInWeek = 7 - day.date.getDay();
                  const cells = Math.min(daysToEnd, daysLeftInWeek);
                  const isEnd = daysToEnd <= daysLeftInWeek;
                  const inset = (isStart ? 0.375 : 0) + (isEnd ? 0.375 : 0);
                  return (
                    <Link
                      key={note.id}
                      href={`/app/note/${note.id}`}
                      title={note.title}
                      style={{ width: `calc(${cells * 100}% + ${cells - 1}px - ${inset}rem)` }}
                      className={cn(
                        "pointer-events-auto h-4 shrink-0 truncate bg-primary/30 px-1.5 text-[11px] leading-4 font-medium text-foreground transition-colors hover:bg-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        isStart && "ml-1.5 rounded-l-sm border-l-2 border-primary",
                        isEnd && "rounded-r-sm",
                      )}
                    >
                      {note.title}
                    </Link>
                  );
                })}
                {hidden > 0 && (
                  <span className="px-1.5 text-[10px] leading-4 font-medium text-foreground/80 sm:px-2">+{hidden} more</span>
                )}
              </div>
            </>
          );
        },
      }}
    />
  );
}
