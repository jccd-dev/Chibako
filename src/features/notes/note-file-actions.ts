import { z } from "zod";
import { flushPendingSaves } from "@/features/organization/organization-client";

const noteInput = z.object({
  note: z.object({ id: z.string(), title: z.string(), folder: z.string(), content: z.string(), kind: z.string() }),
});

/** Reads a note after open editors save, so actions see unsaved edits. */
export async function fetchCurrentNote(id: string) {
  await flushPendingSaves();
  const response = await fetch(`/api/notes/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Could not read Note.");
  return noteInput.parse(await response.json()).note;
}

/** "Title copy", then "Title copy 2", 3, … — the first name free in that folder. */
export function copyTitle(title: string, folder: string, notes: ReadonlyArray<{ title: string; folder: string }>): string {
  const taken = new Set(notes.filter(n => n.folder === folder).map(n => n.title.toLowerCase()));
  const base = `${title} copy`;
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

export function exportFileName(title: string): string {
  const name = title.replace(/[/\\:*?"<>|]/g, "").trim();
  return `${name || "Untitled"}.md`;
}

export function downloadMarkdown(title: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(title);
  link.click();
  // Revoke after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
