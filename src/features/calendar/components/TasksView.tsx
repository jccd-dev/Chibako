"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NoteSummary } from "@/lib/notes";
import { selectChoices } from "@/lib/property-types";
import { isNoteDate, noteDateToDate } from "@/features/calendar/note-dates";
import { folderChoices } from "@/features/calendar/task-folder";
import { filterTable, groupByStatus } from "@/features/calendar/task-table";
import { TaskDrawer } from "@/features/calendar/components/TaskDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { IconPlus } from "@/components/icons";

const ALL_TYPES = "all";
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

function tasksUrl(type: string, folder: string) {
  const params = new URLSearchParams();
  if (type !== "task") params.set("type", type || ALL_TYPES);
  if (folder) params.set("folder", folder);
  const query = params.toString();
  return `/app/tasks${query ? `?${query}` : ""}`;
}

/** Notion-style table of Notes by property, grouped by status. Type defaults to `task` but is only a filter. */
export function TasksView({ initialNotes, vaultFolders, typeOptions, statusOptions, requestedType, requestedFolder }: {
  initialNotes: NoteSummary[];
  vaultFolders: string[];
  typeOptions: string[];
  statusOptions: string[];
  requestedType: string;
  requestedFolder: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [type, setType] = useState(requestedType);
  const [folder, setFolder] = useState(requestedFolder);
  const [drawer, setDrawer] = useState({ open: false, noteId: null as string | null, key: 0 });
  const openNote = (noteId: string | null) => setDrawer((d) => ({ open: true, noteId, key: d.key + 1 }));
  const groups = useMemo(() => groupByStatus(filterTable(notes, type, folder), statusOptions), [notes, type, folder, statusOptions]);
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

  function selectType(next: string) {
    setType(next);
    router.replace(tasksUrl(next, folder), { scroll: false });
  }

  function selectFolder(next: string) {
    setFolder(next);
    router.replace(tasksUrl(type, next), { scroll: false });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <p className="text-xs text-muted-foreground">{count} Note{count === 1 ? "" : "s"} · Type is a filter, any Note can be a task.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect value={type} onChange={(e) => selectType(e.target.value)} aria-label="Filter by type">
            <NativeSelectOption value="">All types</NativeSelectOption>
            {selectChoices(typeOptions, type).map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect value={folder} onChange={(e) => selectFolder(e.target.value)} aria-label="Filter by folder">
            <NativeSelectOption value="">All folders</NativeSelectOption>
            {folders.map((f) => <NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}
          </NativeSelect>
          <Button size="sm" onClick={() => openNote(null)}>
            <IconPlus data-icon="inline-start" />New task
          </Button>
        </div>
      </header>
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
                  <TableHead className="w-[40%]">Title</TableHead>
                  <TableHead className="w-[22%]">Folder</TableHead>
                  <TableHead className="w-[11%]">Type</TableHead>
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
                      <TableCell>{prop(note, "type") && <Badge variant="outline">{prop(note, "type")}</Badge>}</TableCell>
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
              <p className="mt-1 text-xs text-muted-foreground">Create a task or change the Type or folder filter.</p>
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
