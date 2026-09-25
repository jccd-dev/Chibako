"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dateToNoteDate, isNoteDate, noteDateToDate, sortDatedNotes, type DatedNote } from "@/features/calendar/note-dates";
import { DatedNotesCalendar } from "@/components/DatedNotesCalendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@/components/icons";

export function CalendarView({ initialNotes, requestedDate }: {
  initialNotes: DatedNote[];
  requestedDate?: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [selected, setSelected] = useState<string | null>(() => isNoteDate(requestedDate) ? requestedDate : null);
  const selectedNotes = useMemo(
    () => sortDatedNotes(notes.filter((note) => note.date === selected)),
    [notes, selected]
  );
  const refresh = useCallback(async () => {
    const response = await fetch("/api/calendar");
    if (!response.ok) return;
    const data = await response.json() as { notes?: DatedNote[] };
    if (data.notes) setNotes(data.notes);
  }, []);

  useEffect(() => {
    if (selected) return;
    const today = dateToNoteDate(new Date());
    setSelected(today);
    router.replace(`/app/calendar?date=${today}`, { scroll: false });
  }, [router, selected]);

  useEffect(() => {
    const onChange = () => void refresh();
    window.addEventListener("chibako:notes-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("chibako:notes-changed", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [refresh]);

  function selectDate(date: string) {
    setSelected(date);
    router.replace(`/app/calendar?date=${date}`, { scroll: false });
  }

  const heading = selected ? noteDateToDate(selected).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }) : "Loading today…";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Calendar</h1>
        <p className="text-xs text-muted-foreground">Browse Notes by Note date.</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto lg:grid-cols-[20rem_minmax(0,1fr)] lg:content-stretch lg:overflow-hidden">
        <section className="order-2 flex min-h-0 flex-col border-border lg:order-1 lg:border-r">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">{heading}</h2>
              <p className="text-xs text-muted-foreground">{selectedNotes.length} Note{selectedNotes.length === 1 ? "" : "s"}</p>
            </div>
            <Button size="sm" disabled={!selected} onClick={() => selected && router.push(`/app/note/new?date=${selected}`)}>
              <IconPlus data-icon="inline-start" />New note
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="calendar-note-list">
            {selectedNotes.length ? (
              <ul className="flex flex-col gap-1">
                {selectedNotes.map((note) => (
                  <li key={note.id}>
                    <Link href={`/app/note/${note.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{note.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{note.folder || "Vault root"}</span>
                      </span>
                      <Badge variant="outline">{note.kind}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid min-h-40 place-items-center text-center">
                <div>
                  <p className="text-sm font-medium">No Notes for this day</p>
                  <p className="mt-1 text-xs text-muted-foreground">Create one or select another date.</p>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="order-1 flex items-start justify-center p-3 sm:p-6 lg:order-2 lg:overflow-y-auto">
          {selected && <DatedNotesCalendar notes={notes} selected={selected} onSelect={selectDate} />}
        </section>
      </div>
    </div>
  );
}
