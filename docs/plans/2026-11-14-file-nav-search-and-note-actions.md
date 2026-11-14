# File nav search, note actions, and graph labels

Outcome: In a large vault you can narrow the file nav or focus one folder with the same search syntax Cmd+K uses; notes can be duplicated and exported as `.md`; the graph has a Labels on/off toggle.
Problem: The file tree has no way to find or scope within it, so large trees are hard to navigate; full-text search lives in a separate sidebar view while Cmd+K is weaker (7 results, no snippets); notes cannot be duplicated or exported; graph index labels cannot be hidden.
Done when: each slice check below passes, plus `npm test`, `npm run typecheck`, and `npm run lint`.

Decisions:
- Find in nav → filter box in the file tree + "Focus folder", unified: Focus fills the filter with `folder:"<path>"`.
- Search syntax → plain text = title + content + folder (today's FTS); `note:` = titles only; `folder:` = that folder and subfolders; quotes allow spaces; qualifiers combine; unknown or empty qualifiers are plain text.
- Rail search icon → stays, opens Cmd+K; the sidebar search view (`Sidebar.tsx` `searchView`) is removed.
- Cmd+K → gains everything the sidebar search view had (all results, snippets, folder chip, stale-request abort, empty/no-results states, scroll-into-view) plus qualifiers and `folder:` suggestions.
- Duplicate → notes only, "Title copy" / "Title copy N" (free name in that folder), index note duplicates as `kind: "note"`.
- Export → single note `.md` download (frontmatter included), browser only, no dependency.
- Graph labels → toggle hides index labels when nothing is hovered; hover labels unchanged; persisted in localStorage like the layout pattern.
- MCP `search_notes` → unchanged; qualifiers are parsed only in the REST search route.

## Slices

- [x] 1. Graph "Labels" toggle next to Reset view (`aria-pressed`), persisted via a hook shaped like `use-graph-pattern.ts`; `labelOpacity` in `GraphView.tsx` returns 0 for unhovered nodes when off, hover branch untouched — check: toggle off hides index labels; hovering still shows the neighborhood's labels; reload keeps the setting.
  - Done: browser on localhost:3000 — off hides Homes/Projects, hover shows 5 neighborhood labels, off persists across reload (restored to on); typecheck, lint, npm test 675/675.
- [x] 2. "Duplicate" in the note menu (`Sidebar.tsx` `actions`): read the note, `POST /api/notes` with same content, folder, a free "copy" title from the current tree list, `kind: "note"` for the index note; open the new note — check: Playwright in `sidebar-file-management.spec.ts`: duplicate opens "X copy" with the same body and properties; again gives "X copy 2".
  - Done: sidebar-file-management.spec.ts Duplicate test (copy, copy 2, same content/properties) passes; Codex duplicated a note on localhost:3000 and cleaned it up.
- [x] 3. "Export .md" in the note menu: Blob download of the note content as `<title>.md`, stripping `/\:*?"<>|`, falling back to `Untitled.md` — check: Playwright captures the download and its content matches the note; re-importing restores properties.
  - Done: sidebar-file-management.spec.ts Export test (filename sanitized, content exact, re-import restores properties) passes; spec 14/14.
- [ ] 4. Pure query parser (no DB imports, client-safe) returning `{ text, folder?, titleOnly }`; `/api/search` parses `q` and passes folder scope and title-only to `searchNotes`, which filters inside the SQL query so the 50-result limit applies within the folder — depends on nothing — check: Node tests for the parser (quotes, combined, unknown, empty qualifier) and for `searchNotes` with >50 matches outside the folder still returning in-folder matches; `note:` matching titles only.
- [ ] 5. Write the palette Playwright spec first, then: shared `src/features/notes/use-note-search.ts` (debounce + abort + busy, moved from `Sidebar.tsx`); Cmd+K shows all results with snippet and folder chip, notes before commands while searching, empty-query hint with qualifier tip, "No notes in <folder> match …" message, scroll-into-view, `folder:` suggestions from the folder list; palette opens on a window event; rail search icon sends it (closing the mobile sheet first); delete the sidebar search view and its state — depends on 4 — check: spec passes: body-word match shows snippet + folder; fast typing never shows stale results; `folder:Guides x` limits results; rail icon and Cmd+K open the same palette.
- [ ] 6. File nav filter input under "Files" using the same hook and syntax: shows matching notes and their ancestor folders expanded (display-only, user's expanded set untouched); `folder:` alone shows that folder's subtree; Escape/✕ clears; selection clears when the filter changes; folder menu "Focus folder" fills `folder:"<path>"` — depends on 5 — check: Playwright: body-word filter leaves only that note and its parents; Focus Guides shows only Guides; clearing restores the previous tree; a selection made before filtering is cleared.

## Risks

- Duplicate titles: the name is chosen from the client's current list; a concurrent create of the same "copy" name yields two same-titled notes (renamable). Accepted.
- Later, not in scope: property qualifiers (`status:`, `kind:`) via the existing `/api/search` property params; qualifiers in MCP `search_notes`.
