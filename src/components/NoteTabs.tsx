"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconPlus, IconX } from "@/components/icons";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "chibako_note_tabs";

type NoteTab = { id: string; title: string };
type NoteTabEvent = { id: string; title: string };

function noteIdFromPath(pathname: string | null): string | null {
  if (!pathname?.startsWith("/app/note/")) return null;
  const id = pathname.slice("/app/note/".length).split("/")[0];
  return id ? decodeURIComponent(id) : null;
}

function readTabs(): NoteTab[] {
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

function saveTabs(tabs: NoteTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // private mode — tabs still work for this session
  }
}

export function NoteTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const activeId = noteIdFromPath(pathname);
  const [tabs, setTabs] = useState<NoteTab[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setTabs(readTabs());
    setLoaded(true);

    const onTab = (event: Event) => {
      const detail = (event as CustomEvent<NoteTabEvent>).detail;
      if (!detail?.id || typeof detail.title !== "string") return;
      setTabs((current) => {
        const title = detail.title.trim() || "Untitled";
        const index = current.findIndex((tab) => tab.id === detail.id);
        if (index < 0) return [...current, { id: detail.id, title }];
        if (current[index].title === title) return current;
        const next = [...current];
        next[index] = { id: detail.id, title };
        return next;
      });
    };
    window.addEventListener("chibako:note-tab", onTab);
    return () => window.removeEventListener("chibako:note-tab", onTab);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveTabs(tabs);
  }, [loaded, tabs]);

  useEffect(() => {
    if (!loaded || !activeId) return;
    setTabs((current) => {
      const withoutDraft =
        activeId === "new"
          ? current
          : current.filter((tab) => tab.id !== "new");
      if (withoutDraft.some((tab) => tab.id === activeId)) {
        return withoutDraft.length === current.length ? current : withoutDraft;
      }
      return [
        ...withoutDraft,
        { id: activeId, title: activeId === "new" ? "Untitled" : "Loading…" },
      ];
    });
  }, [activeId, loaded]);

  function closeTab(id: string) {
    if (tabs.length === 1) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (id === activeId) {
      const fallback = tabs[index - 1] ?? tabs[index + 1];
      if (fallback) router.push(`/app/note/${fallback.id}`);
    }
  }

  async function createNoteTab() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled", content: "", kind: "note" }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: unknown;
        note?: { id?: unknown; title?: unknown };
      } | null;
      const id = data?.note?.id;
      if (!response.ok || typeof id !== "string" || !id) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Could not create note.",
        );
      }

      const created = {
        id,
        title:
          typeof data?.note?.title === "string" ? data.note.title : "Untitled",
      };
      setTabs((current) => [
        ...current.filter((tab) => tab.id !== "new" && tab.id !== created.id),
        { id: created.id, title: created.title || "Untitled" },
      ]);
      window.dispatchEvent(new Event("chibako:notes-changed"));
      router.push(`/app/note/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create note.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (!activeId) return null;

  return (
    <div
      className="flex h-full min-w-0 flex-1 items-center gap-1"
      role="tablist"
      aria-label="Open notes"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex h-8 max-w-56 min-w-0 shrink-0 items-center rounded-md",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="min-w-0 flex-1 truncate rounded-md px-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                onClick={() => router.push(`/app/note/${tab.id}`)}
              >
                {tab.title}
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.title} tab`}
                className={cn(
                  "mr-1 rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                onClick={() => closeTab(tab.id)}
              >
                <IconX size={13} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New note tab"
          aria-busy={creating}
          disabled={creating}
          className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void createNoteTab()}
        >
          <IconPlus size={16} />
        </button>
      </div>
    </div>
  );
}
