"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NoteSummary } from "@/lib/notes";
import { isNoteDate, noteDateToDate } from "@/features/calendar/note-dates";
import { folderChoices } from "@/features/calendar/task-folder";
import { filterTable, groupByStatus, type ChoiceFilters } from "@/features/calendar/task-table";
import { ChoiceFilter } from "@/features/calendar/components/ChoiceFilter";
import { TaskDrawer } from "@/features/calendar/components/TaskDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FolderPicker } from "@/components/FolderPicker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { IconPlus } from "@/components/icons";

const prop = (note: NoteSummary, key: string) => {
  const value = note.properties[key];
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
};

function formatDate(value: string) {
  return isNoteDate(value) ? noteDateToDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : value;
}

function dateCell(note: NoteSummary) {
  const date = prop(note, "date");
  const end = prop(note, "end_date");
  if (!date) return "—";
  return end && end > date ? `${formatDate(date)} – ${formatDate(end)}` : formatDate(date);
}

function tasksUrl(folder: string, choices: ChoiceFilters) {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  for (const [key, chosen] of Object.entries(choices)) if (chosen.length) params.set(key, chosen.join(","));
  const query = params.toString();
  return `/app/tasks${query ? `?${query}` : ""}`;
}

/** Tasks grouped by status. */
export function TasksView({ initialNotes, vaultFolders, statusOptions, priorityOptions, requestedFolder, requestedChoices }: {
  initialNotes: NoteSummary[];
  vaultFolders: string[];
  statusOptions: string[];
  priorityOptions: string[];
  requestedFolder: string;
  requestedChoices: { status: string[]; priority: string[] };
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [folder, setFolder] = useState(requestedFolder);
  const [choices, setChoices] = useState(requestedChoices);
  const [drawer, setDrawer] = useState({ open: false, noteId: null as string | null, key: 0 });
  const openNote = (noteId: string | null) => setDrawer((d) => ({ open: true, noteId, key: d.key + 1 }));
  const groups = useMemo(() => groupByStatus(filterTable(notes, "task", folder, choices), statusOptions, priorityOptions),
    [notes, folder, choices, statusOptions, priorityOptions],
  );
  const folders = useMemo(() => folderChoices([...vaultFolders, ...notes.map((note) => note.folder), folder]), [vaultFolders, notes, folder]);
  const count = groups.reduce((sum, group) => sum + group.notes.length, 0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/notes");
    if (!response.ok) return;
    const data = await response.json() as { notes?: NoteSummary[] };
    if (data.notes) setNotes(data.notes);
  }, []);

  useEffect(() => {
    const onChange = () => void refresh();
    window.addEventListener("chibako:notes-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener("chibako:notes-changed", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [refresh]);

  function selectFolder(next: string) {
    setFolder(next);
    router.replace(tasksUrl(next, choices), { scroll: false });
  }

  function selectFilter(key: keyof typeof choices, chosen: string[]) {
    const next = { ...choices, [key]: chosen };
    setChoices(next);
    router.replace(tasksUrl(folder, next), { scroll: false });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <p className="text-xs text-muted-foreground">{count} task{count === 1 ? "" : "s"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FolderPicker aria-label="Filter by folder" folders={folders} value={folder} emptyLabel="All folders" onChange={selectFolder} />
          <Button size="sm" onClick={() => openNote(null)}>
            <IconPlus data-icon="inline-start" />New task
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-2 sm:px-6">
        <ChoiceFilter label="Status" options={statusOptions} value={choices.status} onChange={(next) => selectFilter("status", next)} />
        <ChoiceFilter label="Priority" options={priorityOptions} value={choices.priority} onChange={(next) => selectFilter("priority", next)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6" data-testid="tasks-table">
        {groups.length ? groups.map((group) => (
          <section key={group.status || "none"} aria-label={group.status || "No status"} className="mb-6">
            <h2 className="mb-1 flex items-center gap-2 px-2 text-sm font-semibold">
              {group.status || "No status"}
              <span className="text-xs font-normal text-muted-foreground">{group.notes.length}</span>
            </h2>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[51%]">Title</TableHead>
                  <TableHead className="w-[22%]">Folder</TableHead>
                  <TableHead className="w-[10%]">Priority</TableHead>
                  <TableHead className="w-[17%]">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.notes.map((note) => {
                  const done = prop(note, "status").toLowerCase() === "done";
                  return (
                    <TableRow key={note.id} className={cn(done && "opacity-60")}>
                      <TableCell>
                        <button type="button" onClick={() => openNote(note.id)} className={cn("block w-full truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", done && "line-through")}>
                          {note.title}
                        </button>
                      </TableCell>
                      <TableCell className="truncate text-muted-foreground">{note.folder || "Vault root"}</TableCell>
                      <TableCell>{prop(note, "priority") && <Badge variant="outline">{prop(note, "priority")}</Badge>}</TableCell>
                      <TableCell className="truncate text-muted-foreground">{dateCell(note)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        )) : (
          <div className="grid min-h-40 place-items-center text-center">
            <div>
              <p className="text-sm font-medium">No Notes match these filters</p>
              <p className="mt-1 text-xs text-muted-foreground">Create a task or change the filters.</p>
            </div>
          </div>
        )}
      </div>
      {drawer.key > 0 && (
        <TaskDrawer
          key={drawer.key}
          open={drawer.open}
          noteId={drawer.noteId}
          date=""
          onOpenChange={(open) => setDrawer((d) => ({ ...d, open }))}
        />
      )}
    </div>
  );
}
