"use client";

import { useEffect, useRef, useState } from "react";
import { Editor, EditorContent, Extension, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { WikiLink } from "./WikiLinkExtension";
import type { NoteSummary } from "@/lib/notes";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  /** Body markdown (frontmatter already stripped). */
  initialMarkdown: string;
  noteId: string;
  /** Title of the note being edited (excluded from link suggestions). */
  selfTitle: string;
  allNotes: NoteSummary[];
  onBodyChange: (markdown: string) => void;
  onNavigate: (target: string) => void;
  /** ⌘1..⌘4 mode switching while the rich editor is focused. */
  onViewShortcut?: (mode: "write" | "edit" | "split" | "preview") => void;
}

/** Constructs a WYSIWYG round-trip would drop or mangle. */
function hasUnsupportedMarkdown(md: string): boolean {
  const fences = md.replace(/```[\s\S]*?```/g, "");
  const plain = fences.replace(/`[^`\n]*`/g, "");
  return /<!--[\s\S]*?-->/.test(md) || /<(?:\/?[a-zA-Z][\w:-]*|\?|!)[^>]*>/.test(plain);
}

interface MenuState {
  prefix: string;
  from: number;
  left: number;
  top: number;
  matches: NoteSummary[];
}

export function RichTextEditor({
  initialMarkdown,
  noteId,
  selfTitle,
  allNotes,
  onBodyChange,
  onNavigate,
  onViewShortcut,
}: RichTextEditorProps) {
  const [editable] = useState(() => !hasUnsupportedMarkdown(initialMarkdown));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);

  // Refs mirror state so key handlers (bound once at editor creation) always
  // read the latest menu without re-creating the editor.
  const allNotesRef = useRef(allNotes);
  allNotesRef.current = allNotes;
  const selfTitleRef = useRef(selfTitle);
  selfTitleRef.current = selfTitle;
  const bodyChangeRef = useRef(onBodyChange);
  bodyChangeRef.current = onBodyChange;
  const menuRef = useRef<MenuState | null>(null);
  menuRef.current = menu;
  const menuIdxRef = useRef(0);
  menuIdxRef.current = menuIdx;
  const chooseRef = useRef<(title: string) => void>(() => {});
  const wikiPromptRef = useRef<() => void>(() => {});
  const linkPromptRef = useRef<() => void>(() => {});
  const setMenuIdxRef = useRef(setMenuIdx);
  setMenuIdxRef.current = setMenuIdx;
  const setMenuRef = useRef<(m: MenuState | null) => void>(setMenu);
  setMenuRef.current = setMenu;

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        Image.configure({ inline: false, allowBase64: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        WikiLink,
        // Parity with the source editor: ⌘⇧K wikilink, ⌘⇧L link.
        Extension.create({
          name: "chibakoShortcuts",
          addKeyboardShortcuts() {
            return {
              "Mod-Shift-k": () => {
                wikiPromptRef.current();
                return true;
              },
              "Mod-Shift-l": () => {
                linkPromptRef.current();
                return true;
              },
            };
          },
        }),
        Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      ],
      content: initialMarkdown,
      contentType: "markdown",
      editable,
      editorProps: {
        attributes: { class: "focus:outline-none" },
        handleKeyDown(_view, event) {
          const m = menuRef.current;
          if (!m) return false;
          const n = m.matches.length;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setMenuIdxRef.current((menuIdxRef.current + 1) % n);
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setMenuIdxRef.current((menuIdxRef.current - 1 + n) % n);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const pick = m.matches[menuIdxRef.current % n];
            if (pick) chooseRef.current(pick.title);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setMenuRef.current(null);
            return true;
          }
          return false;
        },
      },
      onUpdate({ editor: ed }) {
        bodyChangeRef.current(ed.getMarkdown());
        syncMenu(ed);
      },
    },
    [noteId, editable]
  );

  function matchesFor(prefix: string): NoteSummary[] {
    const p = prefix.toLowerCase();
    const self = selfTitleRef.current.toLowerCase();
    const pool = allNotesRef.current.filter((x) => !x.deleted_at && x.title.toLowerCase() !== self);
    const starts: NoteSummary[] = [];
    const contains: NoteSummary[] = [];
    for (const x of pool) {
      const t = x.title.toLowerCase();
      if (t.startsWith(p)) starts.push(x);
      else if (t.includes(p)) contains.push(x);
    }
    const byTitle = (a: NoteSummary, b: NoteSummary) => a.title.localeCompare(b.title);
    return [...starts.sort(byTitle), ...contains.sort(byTitle)].slice(0, 8);
  }

  function syncMenu(ed: Editor) {
    const { state } = ed;
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || !state.selection.empty || $from.parent.type.name === "codeBlock") {
      setMenuRef.current(null);
      return;
    }
    const before = state.doc.textBetween($from.start(), $from.pos, "\n", "");
    const m = before.match(/\[\[([^\[\]\n]*)$/);
    if (!m) {
      setMenuRef.current(null);
      return;
    }
    const prefix = m[1];
    const from = $from.pos - prefix.length - 2;
    const coords = ed.view.coordsAtPos($from.pos);
    const matches = matchesFor(prefix);
    const left = Math.min(coords.left, Math.max(0, window.innerWidth - 304));
    setMenuRef.current({ prefix, from, left, top: coords.bottom + 6, matches });
    setMenuIdxRef.current(0);
  }

  useEffect(() => {
    const ed = editor;
    if (!ed) return;
    const refresh = () => syncMenu(ed);
    refresh();
    ed.on("selectionUpdate", refresh);
    ed.on("transaction", refresh);
    return () => {
      ed.off("selectionUpdate", refresh);
      ed.off("transaction", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  function choose(title: string) {
    const ed = editor;
    const m = menuRef.current;
    if (!ed || !m) return;
    setMenuRef.current(null);
    const to = m.from + m.prefix.length + 2;
    ed.chain()
      .focus()
      .deleteRange({ from: m.from, to })
      .insertContentAt(m.from, { type: "wikilink", attrs: { target: title, alias: null } })
      .setTextSelection(m.from + 1)
      .run();
  }
  chooseRef.current = choose;
  wikiPromptRef.current = insertWiki;
  linkPromptRef.current = insertLink;

  function insertLink() {
    if (!editor) return;
    const collapsed = editor.state.selection.empty;
    const url = window.prompt("Link URL (https://…)", collapsed ? "https://" : undefined);
    if (url === null) return;
    const href = url.trim();
    if (!href) {
      if (!collapsed) editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (collapsed) editor.chain().focus().insertContent(`[${href}](${href})`).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  function insertWiki() {
    if (!editor) return;
    const title = window.prompt("Note title to link to");
    if (!title?.trim()) return;
    const pos = editor.state.selection.$from.pos;
    editor.chain().focus().insertContentAt(pos, { type: "wikilink", attrs: { target: title.trim(), alias: null } }).setTextSelection(pos + 1).run();
  }

  function handleRootKeyDown(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const map: Record<string, "write" | "edit" | "split" | "preview"> = {
      "1": "write",
      "2": "edit",
      "3": "split",
      "4": "preview",
    };
    const mode = map[e.key.toLowerCase()];
    if (mode) {
      e.preventDefault();
      onViewShortcut?.(mode);
    }
  }

  function handleClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest?.(".wiki-link");
    if (!el) return;
    const target = el.getAttribute("data-wiki-target");
    if (target) onNavigate(target);
  }

  const showMenu = menu !== null && menu.matches.length > 0;

  return (
    <div className="md wt-editor relative" onKeyDown={handleRootKeyDown}>
      {!editable && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          This note has inline HTML or comments that can&apos;t be edited here. Switch to the Edit (source) view for this note.
        </div>
      )}
      <div className="relative px-0.5 pt-1 pb-10" onClick={handleClick}>
        {editable ? (
          <EditorContent editor={editor} />
        ) : (
          <p className="text-sm text-muted-foreground">Rich editing is disabled for this note — switch to the Edit view.</p>
        )}
      </div>

      {showMenu && menu && (
        <div
          role="listbox"
          aria-label="Link suggestions"
          className="fixed z-50 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl fade-in"
          style={{ top: menu.top, left: menu.left }}
        >
          {menu.matches.map((s, i) => (
            <button
              key={s.id}
              role="option"
              aria-selected={i === menuIdx}
              type="button"
              className={cn("block w-full rounded-lg px-3 py-1.5 text-left transition", i === menuIdx && "bg-muted")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s.title)}
              onMouseEnter={() => setMenuIdx(i)}
            >
              <span className="block truncate text-sm font-medium">{s.title}</span>
              {s.folder && <span className="block truncate text-[11px] text-muted-foreground">{s.folder}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
