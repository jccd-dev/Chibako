"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ShortcutRow {
  keys: string[];
  label: string;
}

interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: "Everywhere",
    rows: [
      { keys: ["K"], label: "Command palette" },
      { keys: ["N"], label: "New note" },
      { keys: ["/"], label: "This shortcuts guide" },
    ],
  },
  {
    title: "Views & saving",
    rows: [
      { keys: ["1", "2", "3", "4"], label: "Write · Edit · Split · Preview" },
      { keys: ["S"], label: "Save now" },
      { keys: ["⇧Tab"], label: "Leave the editor with the keyboard" },
    ],
  },
  {
    title: "Write editor (rich)",
    rows: [
      { keys: ["B"], label: "Bold" },
      { keys: ["I"], label: "Italic" },
      { keys: ["U"], label: "Underline" },
      { keys: ["⇧S"], label: "Strikethrough" },
      { keys: ["E"], label: "Inline code" },
      { keys: ["⌥C"], label: "Code block" },
      { keys: ["⇧B"], label: "Quote" },
      { keys: ["⇧7"], label: "Numbered list" },
      { keys: ["⇧8"], label: "Bullet list" },
      { keys: ["⇧9"], label: "Checklist" },
      { keys: ["⌥1", "⌥2", "⌥3"], label: "Heading 1–3" },
      { keys: ["⇧K"], label: "Wikilink chip (or type [[)" },
      { keys: ["⇧L"], label: "Link (asks for the URL)" },
      { keys: ["↵"], label: "Hard line break (⇧↵ also works)" },
      { keys: ["Z", "⇧Z"], label: "Undo / redo" },
    ],
  },
  {
    title: "Source editor (markdown)",
    rows: [
      { keys: ["B", "I"], label: "Bold / italic" },
      { keys: ["⇧X"], label: "Strikethrough" },
      { keys: ["J"], label: "Inline code" },
      { keys: ["⇧J"], label: "Code block" },
      { keys: ["⇧T"], label: "Checklist" },
      { keys: ["⇧B"], label: "Bullet list" },
      { keys: ["⇧L"], label: "Link" },
      { keys: ["⇧K"], label: "Wikilink" },
      { keys: ["Tab"], label: "Insert spaces" },
      { keys: ["Z", "⇧Z"], label: "Undo / redo (browser history)" },
    ],
  },
  {
    title: "Wikilink autocomplete (type [[)",
    rows: [
      { keys: ["↑", "↓"], label: "Move through suggestions" },
      { keys: ["↵", "Tab"], label: "Accept suggestion" },
      { keys: ["Esc"], label: "Dismiss" },
    ],
  },
  {
    title: "Command palette & search",
    rows: [
      { keys: ["↑", "↓"], label: "Move through matches" },
      { keys: ["↵"], label: "Open the selected match" },
      { keys: ["Esc"], label: "Close" },
    ],
  },
];

const TIPS = [
  "Type [[ in any editor to link notes — pick from the menu.",
  "Click a wikilink chip in Write view to open that note.",
  "Click inside a table and row/column buttons appear in the toolbar.",
  "The bookmark icon in the note header adds the note to the sidebar.",
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [modKey, setModKey] = useState("Ctrl+");
  useEffect(() => {
    setModKey(/mac/i.test(navigator.platform ?? "") ? "⌘" : "Ctrl+");
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col gap-0 sm:max-w-md">
        <DialogHeader className="shrink-0 pb-3">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Everything works from the keyboard. Most shortcuts also have a toolbar button.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1">
          {SECTIONS.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h3>
              <ul className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-[13px]">
                {section.rows.map((row) => (
                  <li key={row.label} className="contents">
                    <span className="flex gap-1">
                      {row.keys.map((k) => (
                        <span key={k} className="kbd">{modKey}{k}</span>
                      ))}
                    </span>
                    <span className="text-muted-foreground">{row.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section aria-label="Tips">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Good to know
            </h3>
            <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
              {TIPS.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span aria-hidden className="select-none text-primary">·</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
