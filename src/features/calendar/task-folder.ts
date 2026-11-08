/** Where a task lives for a chosen folder: a `Tasks` folder (or one inside it) is used as is, any other folder gets a `Tasks` child, the vault root maps to `Tasks`. */
export function taskFolder(folder: string): string {
  const path = folder.trim().replace(/^\/+|\/+$/g, "");
  if (!path) return "Tasks";
  return path.split("/").includes("Tasks") ? path : `${path}/Tasks`;
}

/** A Note is a task when its `type` property is `task`, wherever it lives. */
export function isTask(note: { properties: Record<string, unknown> }): boolean {
  return String(note.properties.type ?? "").toLowerCase() === "task";
}

/** True when `noteFolder` is `folder` or one of its subfolders; an empty filter matches everything. */
export function inFolder(noteFolder: string, folder: string): boolean {
  return !folder || noteFolder === folder || noteFolder.startsWith(`${folder}/`);
}

/** Every folder and ancestor folder the given notes live in, sorted. */
export function folderChoices(folders: string[]): string[] {
  const all = new Set<string>();
  for (const folder of folders) {
    const parts = folder.split("/").filter(Boolean);
    parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join("/")));
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}
