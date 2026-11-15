export interface NoteTab {
  id: string;
  title: string;
}

export function restoreNoteTabs(stored: NoteTab[], received: NoteTab[]): NoteTab[] {
  const tabs = new Map(stored.map(tab => [tab.id, tab]));
  for (const tab of received) tabs.set(tab.id, tab);
  return [...tabs.values()];
}

const STORAGE_KEY = "chibako_note_tabs";

export function readTabs(): NoteTab[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((tab): tab is NoteTab => {
      if (!tab || typeof tab !== "object") return false;
      const { id, title } = tab as Partial<NoteTab>;
      if (typeof id !== "string" || !id || seen.has(id)) return false;
      seen.add(id);
      return typeof title === "string";
    });
  } catch {
    return [];
  }
}

export function saveTabs(tabs: NoteTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // private mode — tabs still work for this session
  }
}
