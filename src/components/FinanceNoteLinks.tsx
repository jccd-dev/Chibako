"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import type { FinanceNoteChoice } from "@/features/finance/note-link-types";
import type { FinanceTransaction } from "@/features/finance/activity-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { useFinanceNoteLinks, useFinanceNotePicker } from "@/features/finance/use-finance-note-links";
import { financeControl as control } from "@/features/finance/presentation";

export function FinanceNotePicker({ notes, onChange, disabled }: { notes: FinanceNoteChoice[]; onChange: (notes: FinanceNoteChoice[]) => void; disabled: boolean }) {
  const picker = useFinanceNotePicker();
  const searchId = useId();
  return <FieldGroup>
    <Field>
      <FieldLabel htmlFor={searchId}>Find a Note by title</FieldLabel>
      <Input id={searchId} value={picker.q} maxLength={200} disabled={disabled} className={control} onChange={event => picker.setQ(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void picker.search(); } }} />
      <FieldDescription>Choose up to 20 existing Notes. Linking never changes their content or dates. Transaction text stays on this finance record.</FieldDescription>
      <Button type="button" variant="outline" className={`${control} self-start`} disabled={disabled || picker.loading} onClick={() => void picker.search()}>Find Notes</Button>
    </Field>
    <div aria-label="Selected Note links" className="flex flex-col gap-3">
      <h4 className="text-sm font-medium">Selected Notes ({notes.length}/20)</h4>
      {notes.length ? <ul className="flex flex-col gap-3">{notes.map(note => <li key={note.id} className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-32 break-words text-sm">{note.title}</span>
        <Button type="button" variant="outline" className={control} disabled={disabled} aria-label={`Inspect Note ${note.title}`} onClick={() => void picker.inspect(note.id)}>Inspect</Button>
        <Button type="button" variant="outline" className={control} disabled={disabled} aria-label={`Remove Note link ${note.title}`} onClick={() => onChange(notes.filter(item => item.id !== note.id))}>Remove link</Button>
      </li>)}</ul> : <p className="text-sm text-muted-foreground">No Note links selected.</p>}
    </div>
    {picker.error ? <Alert><AlertDescription>{picker.error} Try Find Notes again.</AlertDescription></Alert> : picker.loading ? <p role="status" className="text-sm text-muted-foreground">Finding Notes…</p> : picker.page ? <div className="flex flex-col gap-3">
      {picker.page.notes.length ? <ul className="flex flex-col gap-3" aria-label="Note search results">{picker.page.notes.map(note => <li key={note.id} className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-32 break-words text-sm">{note.title}</span>
        <Button type="button" variant="outline" className={control} disabled={disabled} aria-label={`Inspect candidate Note ${note.title}`} onClick={() => void picker.inspect(note.id)}>Inspect</Button>
        <Button type="button" variant="outline" className={control} disabled={disabled || notes.length >= 20 || notes.some(item => item.id === note.id)} aria-label={`Select Note ${note.title}`} onClick={() => onChange([...notes, note])}>{notes.some(item => item.id === note.id) ? "Selected" : "Select Note"}</Button>
      </li>)}</ul> : <p className="text-sm text-muted-foreground">No matching Notes outside Trash. Try another title.</p>}
      <nav aria-label="Note search pages" className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className={control} disabled={disabled || picker.page.offset === 0} onClick={() => void picker.search(Math.max(0, picker.page!.offset - 25))}>Previous Notes</Button>
        <span className="text-sm text-muted-foreground">{picker.page.total} matching Notes</span>
        <Button type="button" variant="outline" className={control} disabled={disabled || picker.page.offset + picker.page.limit >= picker.page.total} onClick={() => void picker.search(picker.page!.offset + 25)}>Next Notes</Button>
      </nav>
    </div> : null}
    {picker.previewId && <section aria-label="Read-only Note inspection" className="flex min-w-0 flex-col gap-3 border-y border-border py-4">
      {picker.previewError ? <Alert><AlertDescription>{picker.previewError}<Button type="button" variant="outline" className={control} disabled={disabled} onClick={() => void picker.inspect(picker.previewId!)}>Retry Note inspection</Button></AlertDescription></Alert> : picker.preview ? <>
        <h4 className="break-words text-sm font-medium">{picker.preview.title}</h4>
        <p className="text-sm text-muted-foreground">Read-only Note content. This does not select or change the Note.</p>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm">{picker.preview.content || "This Note is empty."}</pre>
      </> : <p role="status" className="text-sm text-muted-foreground">Loading Note…</p>}
      <Button type="button" variant="outline" className={`${control} self-start`} disabled={disabled} onClick={picker.closePreview}>Close Note inspection</Button>
    </section>}
  </FieldGroup>;
}

export function FinanceNoteLinks({ record, activity, onSaved }: { record: FinanceTransaction; activity: FinanceActivityController; onSaved: (id: string) => void }) {
  const links = useFinanceNoteLinks(record, activity);
  return <details>
    <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">Additional details: Note links</summary>
    <div className="mt-3 flex flex-col gap-4">
      {links.loading ? <p role="status" className="text-sm text-muted-foreground">Loading Note links…</p> : links.error ? <Alert><AlertDescription>{links.error}<div className="mt-3 flex flex-wrap gap-3"><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={() => void links.load()}>Retry Note links</Button><Button type="button" variant="outline" className={control} disabled={activity.busy} onClick={() => onSaved(record.id)}>Refresh transaction details</Button></div></AlertDescription></Alert> : <>
        <FinanceNotePicker notes={links.notes} onChange={links.setNotes} disabled={activity.busy} />
        {activity.saveError && <Alert><AlertDescription>{activity.saveError} Your selection is kept. Retry safely, or refresh details if the record changed.</AlertDescription></Alert>}
        <Button type="button" className={`${control} self-start`} disabled={activity.busy || !links.changed} onClick={async () => { const result = await links.save(); if (result) onSaved(record.id); }}>{activity.busy ? "Saving…" : "Save Note links"}</Button>
      </>}
    </div>
  </details>;
}
