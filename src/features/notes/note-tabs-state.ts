export interface NoteTab {
  id: string;
  title: string;
}

export function restoreNoteTabs(stored: NoteTab[], received: NoteTab[]): NoteTab[] {
  const tabs = new Map(stored.map(tab => [tab.id, tab]));
  for (const tab of received) tabs.set(tab.id, tab);
  return [...tabs.values()];
}
