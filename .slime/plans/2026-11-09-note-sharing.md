# Note sharing with live co-editing

Outcome: The owner shares any single note with named people (co-devs, clients, friends) through a private link. Each link is read-only or editable. Everyone on a shared note types into the same note at the same time and sees each other's cursors, with edits merged automatically. Notes that aren't shared keep the current editor and save behaviour.
Problem: Every way into Chibako today (owner session, scoped API keys) reaches the whole vault, and note saves are last-write-wins. One person can't be given a single note, and two editors overwrite each other.
Done when: The owner and a recipient in two browsers edit one shared note at the same time, and both edits survive in the saved Markdown, with search and links updated. A read link sees live changes but can't edit. A revoked, expired, or trashed share disconnects within seconds and its link returns 404. No other note is reachable.

Decisions:
- What can be shared → any note; the checklist was only an example.
- Identity → one named link per person, each revoked on its own.
- Access → the owner chooses Read or Edit for each link.
- AI access → no WebMCP and no share tools on `/mcp`. The share page is server-rendered, so an agent that can fetch web pages can read it.
- Exposure → the instance is public over HTTPS.
- Stop sharing → one action revokes every link on a note and disconnects everyone immediately.
- Agent writes → while a note is shared, MCP and API-key callers can't update, move, or delete it, but can still read and search it.
- Realtime → true co-editing (Yjs), on shared notes only. Expected load is a handful of people, so performance isn't a concern; the cost is complexity.
- Roadmap → this is the first step toward sharing notes or vaults with clients (see the "Shareable notes" entry in the vault note "Incoming Feature"). Build single-note sharing only for now.

## Design

- **Stack (all free, MIT):** `yjs`, `@hocuspocus/server`, `@hocuspocus/provider`, `@tiptap/extension-collaboration`, and `@tiptap/extension-collaboration-caret`. Confirm package names and Tiptap 3 compatibility when installing.
- **Collab process:** a Hocuspocus server in `src/collab/` with no Next imports, bundled with esbuild the same way as the MCP stdio server and covered by `tests/architecture-boundaries.test.ts`. It runs inside the existing app image and container alongside `server.js`, so the installer, updater, and Compose layout stay as they are. Slice 1 settles the WebSocket path: reuse the existing port through Next (preferred, since nginx already forwards `Upgrade`), or use a second internal port with a proxy `location`. It opens the same SQLite file in WAL mode, which the stdio MCP server already does.
- **Table `note_shares`:** `id`, `note_id`, `recipient_name`, `token_hash`, `access` (`read`|`edit`), `created_at`, `expires_at` (optional), `revoked_at`, `last_used_at`. The token is a random 32-byte value, shown to the owner once and stored hashed like `api_keys`. Bump `SCHEMA_VERSION` with an additive migration.
- **Capability `src/features/sharing/`:** create, list for a note, revoke, revoke all for a note ("Stop sharing"), resolve token, read shared note, and `isNoteShared(noteId)`.
  - The token determines the note; a recipient never supplies a note ID.
  - Unknown, revoked, expired, and trashed links all get the same 404.
  - A note is shared while it has at least one link that isn't revoked or expired.
- **Write lock on shared notes:** enforced in the capabilities (`src/lib/notes.ts` and `features/organization`), not in the transport adapters, so REST, remote MCP, and stdio MCP follow the same rule.
  - Direct update, move, and delete of a shared note are rejected with a clear error: "note is shared; edit it in the editor or stop sharing".
  - Only two callers bypass the lock: the collab store, and the owner-session move/rename/trash routes. Trashing a note ends its sharing. A stale owner tab that tries a REST save is rejected too.
  - Reads, search, recall, and `ingest_note` are unaffected.
- **Collab auth (`onAuthenticate`):**
  - The Origin header must match the instance, to block cross-site WebSocket hijacking.
  - A recipient authenticates with a share token, which is bound to its note; read links get a read-only connection. The owner authenticates with the session cookie, through a session check moved into `src/server/auth`.
  - Limits on connections per token, message size, and document size, plus rate limits on failed authentication.
  - The process re-checks loaded rooms every few seconds and closes connections whose share was revoked or expired, or whose note was trashed.
- **Source of truth stays Markdown in SQLite:**
  - Load: when a room opens, the note's Markdown is converted into a Y document.
  - Store: debounced at about 2 seconds, and at most every 10 seconds. The Y document is serialized back to Markdown, using the same extension set as the editor, and saved through `updateNote` so search and links stay consistent. Embeddings are refreshed through the existing best-effort path.
  - Direct external writes are blocked by the write lock. The only remaining outside change is indirect, such as a rename of another note rewriting a wikilink in this one. The collab process detects it by polling `updated_at` and applies it to the Y document in one transaction. Typing in flight at that moment may be lost; this is accepted.
  - The Y state isn't persisted. An empty room unloads, and the next one rebuilds from Markdown.
- **Shared editor extensions:** one framework-free extension list, used by the owner editor, the recipient editor, and server-side serialization. The recipient editor excludes wikilink autocomplete and anything else that queries the vault.
- **Share page `src/app/s/[token]/page.tsx`:**
  - The server renders a snapshot for agents and for when the collab process is down.
  - The page then connects a Tiptap collab editor, editable or read-only, showing presence names from `recipient_name`.
  - Response headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`. Wikilinks render as plain text.
- **Owner editor:** a note with an active share opens in collab mode. The editor-session controller doesn't save over REST in that mode, and Yjs undo replaces the editor's own history. The editor switches mode only when a note is loaded, never with unsaved local edits.
- **Main risks:**
  1. Markdown round-trip fidelity (slice 3 tests it first).
  2. Same-port WebSocket wiring (slice 1 is a spike for this).
  3. A write path that skips the lock. Slice 2 tests every note write entry point.

## Slices

- [ ] 1. Collab wiring spike: a bundled, Next-free Hocuspocus process launched inside the app container. A WebSocket reaches it through the existing public port, or a documented second port. Check: two browser tabs sync a dummy document against local `docker compose up --build`; `bash scripts/smoke-docker.sh` passes; the architecture-boundaries test covers the collab graph.
- [ ] 2. Sharing capability, schema, migration, write lock, and a portable session check. Depends on none. Check: `node --import tsx --test tests/note-sharing.test.ts` covers create, resolve, revoke, revoke-all, expiry, and trashed → 404. The tests also prove that update, move, and delete of a shared note are rejected with no partial write, through both REST and MCP (protocol test), while reads and search still work. After stop sharing, writes work again. `npm run typecheck` and `npm run test:mcp-stdio` pass.
- [ ] 3. Collab server behaviour. Depends on 1 and 2. Covers the shared extension list, Markdown round-trip, authentication (Origin, owner session, token, read-only), debounced store through `updateNote`, applying external writes, closing revoked or expired rooms, and limits. Check: Node tests with an in-process Hocuspocus server and two provider clients. Clients converge; the stored Markdown, search, and links match; a read client can't write; a revoked share disconnects; a bad Origin is refused; a corpus of existing note shapes survives the round-trip unchanged.
- [ ] 4. Recipient share page: server-rendered snapshot plus live editor, presence, and fallback when collab is down. Depends on 3. Check: Playwright with two browser contexts covering edit → the other sees it; read link is read-only; revoked → disconnected and 404.
- [ ] 5. Owner side: session-only share management routes, and a Share dialog with its own hook kept out of `NoteClient`. The dialog adds a person, chooses Read or Edit, sets an optional expiry (default 30 days), copies the link once, lists shares, revokes one link, or clicks "Stop sharing" to revoke all of them. The owner editor uses collab mode for shared notes. Depends on 3. Check: Playwright where the owner and a recipient type at the same time and both edits persist after reload; "Stop sharing" disconnects the recipient and their link returns 404; a non-shared note still saves normally; unsaved edits survive opening a note that has just been shared.
- [ ] 6. Deployment and release: Dockerfile and entrypoint start both processes, health covers collab, and README/UPDATES document any proxy change. Full verification. Depends on 1–5. Check: `bash scripts/smoke-docker.sh`, `bash scripts/smoke-updates-docker.sh` (disposable), `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` in an isolated build directory.

## Out of scope

WebMCP, share tools on `/mcp`, sharing several notes or a whole vault, linked notes and attachments, offline editing, persisted Y state and version history, and comments. A share token is a bearer secret, so anyone it is forwarded to can use it until it is revoked or expires.
