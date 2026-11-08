"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyFrontmatter, parseFrontmatter, serializeFrontmatter, type PropValue } from "@/lib/markdown";
import { selectChoices, type PropertyDef } from "@/lib/property-types";
import type { Note, NoteSummary } from "@/lib/notes";
import { useNoteEditorSession } from "@/features/notes/editor/useNoteEditorSession";
import { RichTextEditor } from "@/features/notes/components/editor/RichTextEditor";
import { taskFolder } from "@/features/calendar/task-folder";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface TaskValues {
  title: string;
  folder: string;
  date: string;
  endDate: string;
  status: string;
  priority: string;
}

interface TaskLookups {
  folders: string[];
  defs: PropertyDef[];
  notes: NoteSummary[];
}

const SAVE_LABEL = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed" } as const;

function notifyNotesChanged() {
  window.dispatchEvent(new Event("chibako:notes-changed"));
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Request failed");
  return data as T;
}

/** Half-screen task form + rich-text body. `noteId` null starts a new task on `date`. */
export function TaskDrawer({ open, noteId, date, onOpenChange }: {
  open: boolean;
  noteId: string | null;
  date: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [lookups, setLookups] = useState<TaskLookups | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      fetch("/api/properties").then((r) => readJson<{ properties: PropertyDef[] }>(r)),
      fetch("/api/folders").then((r) => readJson<{ folders: string[] }>(r)),
      fetch("/api/notes").then((r) => readJson<{ notes: NoteSummary[] }>(r)),
      noteId ? fetch(`/api/notes/${noteId}`).then((r) => readJson<{ note: Note }>(r)) : Promise.resolve(null),
    ]).then(([properties, folders, notes, loaded]) => {
      if (!current) return;
      setLookups({ defs: properties.properties, folders: folders.folders, notes: notes.notes });
      if (loaded) setNote(loaded.note);
    }, (error: unknown) => {
      if (current) setLoadError(error instanceof Error ? error.message : "Could not load the task");
    });
    return () => { current = false; };
  }, [noteId]);

  async function requestOpenChange(next: boolean) {
    if (next) return onOpenChange(true);
    // Keep the drawer (and its edits) open when the last save fails, like the Note page does.
    if (flushRef.current && !(await flushRef.current())) return;
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={(next) => void requestOpenChange(next)}>
      <SheetContent side="right" className="w-full! gap-0 sm:w-1/2! sm:max-w-none!">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{note ? "Task" : "New task"}</SheetTitle>
          <SheetDescription>{note ? "Changes save automatically." : "Tasks are saved in a Tasks folder inside the folder you pick."}</SheetDescription>
        </SheetHeader>
        {loadError ? (
          <p className="p-4 text-sm text-destructive" role="alert">{loadError}</p>
        ) : !lookups || (noteId && !note) ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : note ? (
          <TaskEditor key={note.id} initial={note} lookups={lookups} flushRef={flushRef} />
        ) : (
          <TaskCreateForm date={date} lookups={lookups} onCreated={setNote} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskCreateForm({ date, lookups, onCreated }: {
  date: string;
  lookups: TaskLookups;
  onCreated: (note: Note) => void;
}) {
  const [values, setValues] = useState<TaskValues>({ title: "", folder: taskFolder(""), date, endDate: "", status: "", priority: "" });
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!values.title.trim()) return;
    setSaving(true);
    try {
      const properties: Record<string, PropValue> = { type: "task", date: values.date };
      if (values.endDate) properties.end_date = values.endDate;
      if (values.status) properties.status = values.status;
      if (values.priority) properties.priority = values.priority;
      const { note } = await readJson<{ note: Note }>(await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.title.trim(), folder: values.folder, properties }),
      }));
      notifyNotesChanged();
      onCreated(note);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the task");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <TaskFields values={values} lookups={lookups} onChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))} />
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !values.title.trim() || !values.date}>Create task</Button>
      </div>
    </form>
  );
}

function TaskEditor({ initial, lookups, flushRef }: {
  initial: Note;
  lookups: TaskLookups;
  flushRef: RefObject<(() => Promise<boolean>) | null>;
}) {
  const router = useRouter();
  const session = useNoteEditorSession(initial, {
    save: async (current, patch, full) => {
      const response = await fetch(current ? `/api/notes/${current.id}` : "/api/notes", {
        method: current ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current ? patch : full),
        keepalive: true,
      });
      return (await readJson<{ note: Note }>(response)).note;
    },
    onSaved: notifyNotesChanged,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed"),
  });
  const { note, title, folder, content, saveState, patch, persist } = session;
  const { props, body } = parseFrontmatter(content);

  useEffect(() => {
    flushRef.current = () => persist().then(() => true, () => false);
    return () => { flushRef.current = null; };
  }, [flushRef, persist]);

  const prop = (key: string) => {
    const value = props[key];
    return Array.isArray(value) ? value.join(", ") : String(value ?? "");
  };
  const values: TaskValues = { title, folder, date: prop("date"), endDate: prop("end_date"), status: prop("status"), priority: prop("priority") };
  const propKeys = { date: "date", endDate: "end_date", status: "status", priority: "priority" } as const;

  function change(field: keyof TaskValues, value: string) {
    if (field === "title") return patch({ title: value });
    if (field === "folder") return patch({ folder: value });
    patch({ content: applyFrontmatter(content, { [propKeys[field]]: value || null }) });
  }

  function navigate(target: string) {
    const match = lookups.notes.find((n) => n.title.toLowerCase() === target.toLowerCase());
    if (match) router.push(`/app/note/${match.id}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <TaskFields values={values} lookups={lookups} onChange={change} />
      <div className="min-h-48 flex-1 rounded-md border border-border px-3 py-2" aria-label="Task body">
        <RichTextEditor
          noteId={initial.id}
          markdown={body}
          selfTitle={title}
          allNotes={lookups.notes}
          onBodyChange={(md) => patch({ content: serializeFrontmatter(parseFrontmatter(content).props) + md })}
          onNavigate={navigate}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status">{SAVE_LABEL[saveState]}</span>
        <Link href={`/app/note/${note?.id ?? initial.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">Open full note</Link>
      </div>
    </div>
  );
}

function TaskFields({ values, lookups, onChange }: {
  values: TaskValues;
  lookups: TaskLookups;
  onChange: (field: keyof TaskValues, value: string) => void;
}) {
  const optionsFor = (name: string) => lookups.defs.find((def) => def.name === name && def.type === "select")?.options ?? [];
  const folders = selectChoices(["", ...lookups.folders], values.folder);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
        Title
        <Input value={values.title} onChange={(e) => onChange("title", e.target.value)} aria-label="Task title" autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
        Folder
        <NativeSelect className="w-full" value={values.folder} onChange={(e) => onChange("folder", taskFolder(e.target.value))} aria-label="Task folder">
          {folders.map((f) => <NativeSelectOption key={f} value={f}>{f || "Vault root"}</NativeSelectOption>)}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        Date
        <Input type="date" value={values.date} onChange={(e) => e.target.value && onChange("date", e.target.value)} aria-label="Task date" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        End date
        <Input type="date" value={values.endDate} onChange={(e) => onChange("endDate", e.target.value)} aria-label="Task end date" />
      </label>
      <ChoiceField label="Status" value={values.status} options={optionsFor("status")} onChange={(v) => onChange("status", v)} />
      <ChoiceField label="Priority" value={values.priority} options={optionsFor("priority")} onChange={(v) => onChange("priority", v)} />
    </div>
  );
}

function ChoiceField({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      {options.length ? (
        <NativeSelect className="w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Task ${label.toLowerCase()}`}>
          {["", ...selectChoices(options, value)].map((o) => <NativeSelectOption key={o} value={o}>{o || "—"}</NativeSelectOption>)}
        </NativeSelect>
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Task ${label.toLowerCase()}`} />
      )}
    </label>
  );
}
