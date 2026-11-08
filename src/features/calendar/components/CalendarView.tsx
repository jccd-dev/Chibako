"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { coversDate, dateToNoteDate, isNoteDate, noteDateToDate, sortDatedNotes, type DatedNote } from "@/features/calendar/note-dates";
import { DatedNotesCalendar } from "@/features/calendar/components/DatedNotesCalendar";
import { TaskDrawer } from "@/features/calendar/components/TaskDrawer";
import { folderChoices, inFolder, isTask } from "@/features/calendar/task-folder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { IconPlus } from "@/components/icons";

const isDone = (note: DatedNote) => String(note.properties.status ?? "").toLowerCase() === "done";

function formatRange(note: DatedNote) {
  const format = (value: string) => noteDateToDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${format(note.date)} – ${format(note.endDate)}`;
}

function calendarUrl(date: string, folder: string, tasksOnly: boolean) {
  return `/app/calendar?date=${date}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}${tasksOnly ? "&tasks=1" : ""}`;
}

export function CalendarView({ initialNotes, vaultFolders, requestedDate, requestedFolder = "", requestedTasksOnly = false }: {
  initialNotes: DatedNote[];
  vaultFolders: string[];
  requestedDate?: string;
  requestedFolder?: string;
  requestedTasksOnly?: boolean;
}) {
  const router = useRouter();
  const [allNotes, setNotes] = useState(initialNotes);
  const [folder, setFolder] = useState(requestedFolder);
  const [tasksOnly, setTasksOnly] = useState(requestedTasksOnly);
  const notes = useMemo(
    () => allNotes.filter((note) => inFolder(note.folder, folder) && (!tasksOnly || isTask(note))),
    [allNotes, folder, tasksOnly]
  );
  const folders = useMemo(() => folderChoices([...vaultFolders, ...allNotes.map((note) => note.folder), folder]), [vaultFolders, allNotes, folder]);
  const [chosenDate, setSelected] = useState<string | null>(() => isNoteDate(requestedDate) ? requestedDate : null);
  const [drawer, setDrawer] = useState({ open: false, noteId: null as string | null, key: 0 });
  const openTask = (noteId: string | null) => setDrawer((d) => ({ open: true, noteId, key: d.key + 1 }));
  const hydrated = useHydrated();
  const [initialToday, setInitialToday] = useState<string | null>(null);
  if (hydrated && initialToday === null) setInitialToday(dateToNoteDate(new Date()));
  const selected = chosenDate ?? initialToday;
  const selectedNotes = useMemo(
    () => sortDatedNotes(selected ? notes.filter((note) => coversDate(note, selected)) : []),
    [notes, selected]
  );
  const refresh = useCallback(async () => {
    const response = await fetch("/api/calendar");
    if (!response.ok) return;
    const data = await response.json() as { notes?: DatedNote[] };
    if (data.notes) setNotes(data.notes);
  }, []);

  useEffect(() => {
    if (!chosenDate && selected) router.replace(calendarUrl(selected, folder, tasksOnly), { scroll: false });
  }, [router, chosenDate, selected, folder, tasksOnly]);

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
    router.replace(calendarUrl(date, folder, tasksOnly), { scroll: false });
  }

  function selectFolder(next: string) {
    setFolder(next);
    if (selected) router.replace(calendarUrl(selected, next, tasksOnly), { scroll: false });
  }

  function selectTasksOnly(next: boolean) {
    setTasksOnly(next);
    if (selected) router.replace(calendarUrl(selected, folder, next), { scroll: false });
  }

  const heading = selected ? noteDateToDate(selected).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }) : "Loading today…";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Calendar</h1>
          <p className="text-xs text-muted-foreground">Browse Notes by Note date or date range (date to end_date).</p>
        </div>
        <div className="flex items-center gap-2">
          <Toggle variant="outline" pressed={tasksOnly} onPressedChange={selectTasksOnly}>Tasks only</Toggle>
          <NativeSelect value={folder} onChange={(e) => selectFolder(e.target.value)} aria-label="Filter by folder">
            <NativeSelectOption value="">All folders</NativeSelectOption>
            {folders.map((f) => <NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto lg:grid-cols-[20rem_minmax(0,1fr)] lg:content-stretch lg:overflow-hidden">
        <section className="order-2 flex min-h-0 flex-col border-border lg:order-1 lg:border-r">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">{heading}</h2>
              <p className="text-xs text-muted-foreground">{selectedNotes.length} Note{selectedNotes.length === 1 ? "" : "s"}</p>
            </div>
            <Button size="icon" disabled={!selected} onClick={() => openTask(null)} aria-label="Add note or task" title="Add note or task">
              <IconPlus />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="calendar-note-list">
            {selectedNotes.length ? (
              <ul className="flex flex-col gap-1">
                {selectedNotes.map((note) => (
                  <li key={note.id}>
                    <button type="button" onClick={() => openTask(note.id)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <span className={cn("min-w-0 flex-1", isDone(note) && "opacity-60")}>
                        <span className={cn("block truncate text-sm font-medium", isDone(note) && "line-through")}>{note.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {note.endDate > note.date && <>{formatRange(note)} · </>}{note.folder || "Vault root"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {typeof note.properties.status === "string" && note.properties.status && <Badge variant="secondary">{note.properties.status}</Badge>}
                        {typeof note.properties.priority === "string" && note.properties.priority && <Badge variant="outline">{note.properties.priority}</Badge>}
                        <Badge variant="outline">{isTask(note) ? "task" : note.kind}</Badge>
                      </span>
                    </button>
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
        <section className="order-1 flex min-h-0 p-3 sm:p-6 lg:order-2 lg:overflow-y-auto">
          {selected && <DatedNotesCalendar notes={notes} selected={selected} onSelect={selectDate} onOpenNote={openTask} />}
        </section>
      </div>
      {selected && (
        <TaskDrawer
          key={drawer.key}
          open={drawer.open}
          noteId={drawer.noteId}
          date={selected}
          onOpenChange={(open) => setDrawer((d) => ({ ...d, open }))}
        />
      )}
    </div>
  );
}
