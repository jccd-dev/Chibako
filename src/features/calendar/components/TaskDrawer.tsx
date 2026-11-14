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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-inputs";
import { FolderPicker } from "@/components/FolderPicker";

interface TaskValues {
  title: string;
  folder: string;
  type: string;
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

/** Half-screen task form + rich-text body. `noteId` null starts a new task on `date` ("" = undated). */
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
          <SheetDescription>{note ? "Changes save automatically." : "A task is a Note with Type set to task. Save it in any folder."}</SheetDescription>
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
  const [values, setValues] = useState<TaskValues>({ title: "", folder: "", type: "task", date, endDate: "", status: "", priority: "" });
  const [body, setBody] = useState("");
  const [nested, setNested] = useState(true);
  const [saving, setSaving] = useState(false);
  const target = nested ? taskFolder(values.folder) : values.folder;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!values.title.trim()) return;
    setSaving(true);
    try {
      const properties: Record<string, PropValue> = {};
      if (values.date) properties.date = values.date;
      if (values.type) properties.type = values.type;
      if (values.endDate) properties.end_date = values.endDate;
      if (values.status) properties.status = values.status;
      if (values.priority) properties.priority = values.priority;
      const { note } = await readJson<{ note: Note }>(await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.title.trim(), folder: target, content: body, properties }),
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
      <div className="min-h-48 shrink-0 rounded-md border border-border px-3 py-2" aria-label="Task body">
        <RichTextEditor
          noteId="new"
          markdown={body}
          selfTitle={values.title}
          allNotes={lookups.notes}
          onBodyChange={setBody}
          onNavigate={() => {}}
        />
      </div>
      <Field orientation="horizontal">
        <Checkbox id="task-nested" checked={nested} onCheckedChange={(checked) => setNested(checked)} />
        <FieldLabel htmlFor="task-nested" className="font-normal">Put it in a Tasks subfolder</FieldLabel>
      </Field>
      <p className="text-xs text-muted-foreground" data-testid="task-target-folder">Saves to {target || "Vault root"}</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !values.title.trim()}>Create task</Button>
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
  const values: TaskValues = { title, folder, type: prop("type"), date: prop("date"), endDate: prop("end_date"), status: prop("status"), priority: prop("priority") };
  const propKeys = { type: "type", date: "date", endDate: "end_date", status: "status", priority: "priority" } as const;

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
      <div className="min-h-48 shrink-0 rounded-md border border-border px-3 py-2" aria-label="Task body">
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
  return (
    <FieldGroup className="grid gap-3 sm:grid-cols-2">
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor="task-title">Title</FieldLabel>
        <Input id="task-title" value={values.title} onChange={(e) => onChange("title", e.target.value)} aria-label="Task title" autoFocus />
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor="task-folder">Folder</FieldLabel>
        <FolderPicker
          id="task-folder"
          aria-label="Task folder"
          className="w-full max-w-none"
          folders={selectChoices(lookups.folders, values.folder).filter(Boolean)}
          value={values.folder}
          emptyLabel="Vault root"
          onChange={(v) => onChange("folder", v)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="task-date">Date</FieldLabel>
        <DateInput id="task-date" aria-label="Task date" value={values.date} onChange={(v) => onChange("date", v)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="task-end-date">End date</FieldLabel>
        <DateInput id="task-end-date" aria-label="Task end date" min={values.date || undefined} value={values.endDate} onChange={(v) => onChange("endDate", v)} />
      </Field>
      <ChoiceField label="Type" value={values.type} options={optionsFor("type")} onChange={(v) => onChange("type", v)} />
      <ChoiceField label="Status" value={values.status} options={optionsFor("status")} onChange={(v) => onChange("status", v)} />
      <ChoiceField label="Priority" value={values.priority} options={optionsFor("priority")} onChange={(v) => onChange("priority", v)} />
    </FieldGroup>
  );
}

/** A select for a property; `options` empty means the property has no select definition, so it falls back to free text. */
function ChoiceField({ label, value, options, onChange, emptyLabel = "—", className }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const id = `task-${label.toLowerCase()}`;
  const ariaLabel = `Task ${label.toLowerCase()}`;
  const choices = ["", ...selectChoices(options, value).filter(Boolean)];
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {options.length ? (
        <Select
          items={Object.fromEntries(choices.map((o) => [o, o || emptyLabel]))}
          value={value}
          onValueChange={(next) => { if (next !== null) onChange(next); }}
        >
          <SelectTrigger id={id} aria-label={ariaLabel} className="w-full px-2 py-0.5 text-xs/relaxed shadow-none data-[size=default]:h-7 bg-input/20 [&_svg:not([class*='size-'])]:size-3.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((o) => <SelectItem key={o} value={o}>{o || emptyLabel}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} />
      )}
    </Field>
  );
}
