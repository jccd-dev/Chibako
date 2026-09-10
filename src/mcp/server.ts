import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getDb, DATA_DIR, now } from "../lib/db";
import { getPropertyDefs } from "../lib/properties";
import {
  listNotes,
  searchNotes,
  getNote,
  getNoteByTitle,
  getOutlinks,
  getBacklinks,
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  purgeNote,
  graphData,
  filterByProperties,
  type PropertyFilter,
} from "../lib/notes";
import {
  recall,
  saveObservation,
  listObservations,
  deleteObservation,
  indexEmbeddings,
  getEmbeddingStatus,
} from "../lib/recall";

// ---------- auth ----------

function authorize(required: string): boolean {
  const configured = process.env.CHIBAKO_API_KEY;
  if (!configured) return true; // direct DB access, no key configured
  const hash = createHash("sha256").update(configured).digest("hex");
  const row = getDb().prepare(`SELECT scopes FROM api_keys WHERE key_hash = ?`).get(hash) as { scopes: string } | undefined;
  if (!row) return false;
  const scopes = row.scopes.split(",");
  if (scopes.includes("*") || scopes.includes(required)) {
    getDb().prepare(`UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`).run(now(), hash);
    return true;
  }
  return false;
}

function authorizeAny(required: string[]): boolean {
  const configured = process.env.CHIBAKO_API_KEY;
  if (!configured) return true; // direct DB access, no key configured
  const hash = createHash("sha256").update(configured).digest("hex");
  const row = getDb().prepare(`SELECT scopes FROM api_keys WHERE key_hash = ?`).get(hash) as { scopes: string } | undefined;
  if (!row) return false;
  const scopes = row.scopes.split(",");
  if (scopes.includes("*") || required.some((r) => scopes.includes(r))) {
    getDb().prepare(`UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`).run(now(), hash);
    return true;
  }
  return false;
}
function deny(): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: "unauthorized: API key lacks the required scope" }], isError: true };
}

function ok(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(msg: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: `error: ${msg}` }], isError: true };
}

const str = z.string();

const idOrTitle = { id: str.optional(), title: str.optional() };

/** Frontmatter-safe property value: scalar, string list, or null (delete key). */
const propValue = z.union([str, z.number(), z.boolean(), z.array(str), z.null()]);
const propPatch = z.record(str, propValue);

function propFilters(args: { prop_key?: string; prop_value?: string }): PropertyFilter[] {
  if (args.prop_key && args.prop_value) return [{ key: args.prop_key, value: args.prop_value }];
  return [];
}

// ---------- tools ----------

const server = new McpServer({ name: "chibako", version: "0.1.0" });

server.registerTool("list_notes", {
  title: "List notes",
  description: "List all notes. Returns only ids, titles, folders and kinds — a tiny payload, ideal for building an index. Optionally filter by folder, kind (note|wiki|index), or a property (prop_key + prop_value, substring match; tags match any item).",
  inputSchema: z.object({ folder: str.optional(), kind: str.optional(), prop_key: str.optional(), prop_value: str.optional() }),
}, (args: { folder?: string; kind?: string; prop_key?: string; prop_value?: string }) => {
  if (!authorize("notes:read")) return deny();
  let notes = listNotes();
  if (args.folder) notes = notes.filter((n) => n.folder.startsWith(args.folder!));
  if (args.kind) notes = notes.filter((n) => n.kind === args.kind);
  notes = filterByProperties(notes, propFilters(args));
  return ok({ count: notes.length, notes: notes.map((n) => ({ ...n, properties: Object.keys(n.properties).length ? n.properties : undefined })) });
});

server.registerTool("search_notes", {
  title: "Search notes",
  description: "Full-text search across all note titles and content. Returns matching notes with a snippet. Use before read_note to locate the right note cheaply. Optionally narrow by a property (prop_key + prop_value).",
  inputSchema: z.object({ query: str, prop_key: str.optional(), prop_value: str.optional() }),
}, (args: { query: string; prop_key?: string; prop_value?: string }) => {
  if (!authorizeAny(["notes:read", "search:read"])) return deny();
  const results = searchNotes(args.query, propFilters(args));
  return ok({ count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, folder: r.folder, snippet: r.snippet })) });
});

server.registerTool("recall", {
  title: "Recall relevant context (token-budgeted)",
  description: "Semantic recall, the recommended way to load context. Always BM25-ranked; when embeddings are enabled (CHIBAKO_EMBEDDING_*) it fuses vector similarity too. Returns only ranked titles + trimmed snippets, capped at a token budget — never full note bodies. Use this instead of search_notes when you want context, not a full dump.",
  inputSchema: z.object({ query: str, limit: z.number().int().min(1).max(50).optional(), budget: z.number().int().min(100).max(20000).optional() }),
}, async (args: { query: string; limit?: number; budget?: number }) => {
  if (!authorizeAny(["notes:read", "search:read"])) return deny();
  try {
    const items = await recall({ query: args.query, limit: args.limit, budget: args.budget });
    return ok({ count: items.length, results: items });
  } catch (e) {
    return fail(`recall failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

server.registerTool("memory_save", {
  title: "Save an observation/decision",
  description: "Persist an explicit observation, decision, or pattern into the vault's observation log. Attach note_id (a note id) when it relates to a specific note. The log is searchable context for future sessions. Use this when you learned something worth remembering that isn't a full note.",
  inputSchema: z.object({ content: str, note_id: str.optional(), source: str.optional() }),
}, (args: { content: string; note_id?: string; source?: string }) => {
  if (!authorize("notes:write")) return deny();
  try {
    const obs = saveObservation({ content: args.content, note_id: args.note_id, source: args.source });
    return ok({ id: obs.id, note_id: obs.note_id, created_at: obs.created_at, saved: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});

server.registerTool("list_observations", {
  title: "List observations",
  description: "List recent entries from the observation log (decisions/patterns saved via memory_save), newest first. Optionally limit count.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }),
}, (args: { limit?: number }) => {
  if (!authorize("notes:read")) return deny();
  const list = listObservations(args.limit ?? 50);
  return ok({ count: list.length, observations: list });
});

server.registerTool("delete_observation", {
  title: "Delete an observation",
  description: "Remove one entry from the observation log by id.",
  inputSchema: z.object({ id: str }),
}, (args: { id: string }) => {
  if (!authorize("notes:write")) return deny();
  if (!deleteObservation(args.id)) return fail("observation not found");
  return ok({ deleted: args.id });
});

server.registerTool("index_embeddings", {
  title: "Index note embeddings",
  description: "Build/refresh the vector embeddings index for semantic recall. Requires embeddings to be enabled via CHIBAKO_EMBEDDING_* env vars; otherwise this is a no-op. Call after enabling embeddings to backfill existing notes.",
  inputSchema: z.object({}),
}, async () => {
  if (!authorizeAny(["notes:write", "schema:write"])) return deny();
  try {
    const res = await indexEmbeddings();
    return ok(res);
  } catch (e) {
    return fail(`embedding indexing failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

server.registerTool("embedding_status", {
  title: "Embedding status",
  description: "Check whether semantic embeddings are enabled and how many notes are indexed.",
  inputSchema: z.object({}),
}, () => {
  if (!authorize("notes:read")) return deny();
  return ok(getEmbeddingStatus());
});

server.registerTool("read_note", {
  title: "Read note",
  description: "Read one note by id or exact title. Returns the full note as plain Markdown with metadata (id, title, folder, kind). Prefer ingest_note to also get links in one call.",
  inputSchema: z.object(idOrTitle),
}, (args: { id?: string; title?: string }) => {
  if (!authorize("notes:read")) return deny();
  const note = args.id ? getNote(args.id) : args.title ? getNoteByTitle(args.title) : null;
  if (!note) return fail("note not found");
  return ok({ id: note.id, title: note.title, folder: note.folder, kind: note.kind, updated_at: note.updated_at, properties: note.properties, content: note.content });
});

server.registerTool("get_links", {
  title: "Get note links",
  description: "Outbound [[wikilinks]] and inbound backlinks for a note. Backlinks are computed from the whole vault. Returns titles/ids only to keep the payload small.",
  inputSchema: z.object(idOrTitle),
}, (args: { id?: string; title?: string }) => {
  if (!authorize("notes:read")) return deny();
  const note = args.id ? getNote(args.id) : args.title ? getNoteByTitle(args.title) : null;
  if (!note) return fail("note not found");
  const out = getOutlinks(note.id).map((l) => ({ target: l.target_title, resolved: Boolean(l.target_id), target_id: l.target_id }));
  const back = getBacklinks(note.title).map((b) => ({ id: b.id, title: b.title, folder: b.folder }));
  return ok({ note: note.title, outlinks: out, backlinks: back });
});

server.registerTool("create_note", {
  title: "Create note",
  description: "Create a new note. Title defaults to the first # heading if omitted. Content is plain Markdown; use [[Note Title]] to link to other notes. kind: note|wiki|index. properties: optional frontmatter values (e.g. { status: \"draft\", tags: [\"a\", \"b\"] }) — check get_property_defs for the vault's typed dictionary.",
  inputSchema: z.object({ title: str.optional(), folder: str.optional(), content: str, kind: str.optional(), properties: propPatch.optional() }),
}, (args: { title?: string; folder?: string; content: string; kind?: string; properties?: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorize("notes:write")) return deny();
  const kind = args.kind === "wiki" || args.kind === "index" ? args.kind : "note";
  const note = createNote({ title: args.title, folder: args.folder, content: args.content, kind, properties: args.properties });
  return ok({ id: note.id, title: note.title, folder: note.folder, properties: note.properties, created: true });
});

server.registerTool("update_note", {
  title: "Update note",
  description: "Update a note by id. Pass only the fields to change (title, folder, content, kind, properties). Renaming a title automatically re-points all [[backlinks]]. properties merges into the existing frontmatter (null removes a key). Returns the updated note.",
  inputSchema: z.object({ id: str, title: str.optional(), folder: str.optional(), content: str.optional(), kind: str.optional(), properties: propPatch.optional() }),
}, (args: { id: string; title?: string; folder?: string; content?: string; kind?: string; properties?: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorize("notes:write")) return deny();
  const kind = args.kind === "wiki" || args.kind === "index" ? args.kind : undefined;
  const updated = updateNote(args.id, { title: args.title, folder: args.folder, content: args.content, kind, properties: args.properties });
  if (!updated) return fail("note not found");
  return ok({ id: updated.id, title: updated.title, folder: updated.folder, properties: updated.properties, updated_at: updated.updated_at, saved: true });
});

server.registerTool("set_properties", {
  title: "Set note properties",
  description: "Set frontmatter properties on one note by id or title, merging with existing values (null removes a key). Typed definitions live in get_property_defs — prefer those keys and values for consistency.",
  inputSchema: z.object({ ...idOrTitle, properties: propPatch }),
}, (args: { id?: string; title?: string; properties: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorize("notes:write")) return deny();
  const note = args.id ? getNote(args.id) : args.title ? getNoteByTitle(args.title) : null;
  if (!note) return fail("note not found");
  const updated = updateNote(note.id, { properties: args.properties });
  if (!updated) return fail("note not found");
  return ok({ id: updated.id, title: updated.title, properties: updated.properties, saved: true });
});

server.registerTool("get_property_defs", {
  title: "Get property definitions",
  description: "The vault's typed property dictionary (name, type, allowed options). Read this once to learn which properties (e.g. status, tags, category) notes carry and which values are canonical.",
  inputSchema: z.object({}),
}, () => {
  if (!authorizeAny(["schema:read", "notes:read"])) return deny();
  return ok({ properties: getPropertyDefs() });
});

server.registerTool("delete_note", {
  title: "Delete note",
  description: "Move a note to Trash by id or title. Recoverable for 30 days via restore_note. Only call this when the user explicitly confirms deletion.",
  inputSchema: z.object(idOrTitle),
}, (args: { id?: string; title?: string }) => {
  if (!authorize("notes:write")) return deny();
  const note = args.id ? getNote(args.id) : args.title ? getNoteByTitle(args.title) : null;
  if (!note) return fail("note not found");
  deleteNote(note.id);
  return ok({ trashed: note.title });
});

server.registerTool("restore_note", {
  title: "Restore note",
  description: "Restore a trashed note by id. Returns the restored note.",
  inputSchema: z.object({ id: str }),
}, (args: { id: string }) => {
  if (!authorize("notes:write")) return deny();
  const note = restoreNote(args.id);
  if (!note) return fail("note not found in trash");
  return ok({ id: note.id, title: note.title, restored: true });
});

server.registerTool("purge_note", {
  title: "Purge note permanently",
  description: "Permanently delete a trashed note by id. Destructive and irreversible. Only call this when the user explicitly confirms permanent deletion.",
  inputSchema: z.object({ id: str }),
}, (args: { id: string }) => {
  if (!authorize("notes:write")) return deny();
  if (!purgeNote(args.id)) return fail("note not found");
  return ok({ purged: args.id });
});

server.registerTool("get_graph", {
  title: "Get graph",
  description: "All vault nodes (notes) and edges (resolved wikilinks). Useful for understanding the shape of the knowledge base or finding orphaned notes.",
  inputSchema: z.object({}),
}, () => {
  if (!authorize("notes:read")) return deny();
  const g = graphData();
  const byId = new Map(g.nodes.map((n) => [n.id, n.title]));
  return ok({
    node_count: g.nodes.length,
    link_count: g.links.length,
    notes: g.nodes.map((n) => ({ id: n.id, title: n.title, folder: n.folder, kind: n.kind })),
    links: g.links.map((l) => ({ source: byId.get(l.source) ?? l.source, target: byId.get(l.target) ?? l.target })),
  });
});

server.registerTool("get_knowledge_schema", {
  title: "Get knowledge schema",
  description: "Read the AGENTS.md brain instructions for this vault: how to categorize, link, compile wiki pages, and handle contradictions. Read this once at the start of a session.",
  inputSchema: z.object({}),
}, () => {
  if (!authorize("schema:read")) return deny();
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = 'knowledge_schema'`).get() as { value: string } | undefined;
  return ok({ schema: row?.value ?? "(no schema configured)" });
});

server.registerTool("ingest_note", {
  title: "Ingest note (token-efficient)",
  description: "The recommended single call for loading context about one note: returns the note content plus its outlinks/backlinks plus the knowledge schema in one round trip. Use this instead of read_note + get_links + get_knowledge_schema.",
  inputSchema: z.object(idOrTitle),
}, (args: { id?: string; title?: string }) => {
  if (!authorize("notes:read")) return deny();
  const note = args.id ? getNote(args.id) : args.title ? getNoteByTitle(args.title) : null;
  if (!note) return fail("note not found");
  const out = getOutlinks(note.id).map((l) => l.target_title);
  const back = getBacklinks(note.title).map((b) => ({ id: b.id, title: b.title }));
  const schema = getDb().prepare(`SELECT value FROM settings WHERE key = 'knowledge_schema'`).get() as { value: string } | undefined;
  return ok({
    note: { id: note.id, title: note.title, folder: note.folder, kind: note.kind, updated_at: note.updated_at, properties: note.properties, content: note.content },
    outlinks: out,
    backlinks: back,
    schema: schema?.value ?? "(no schema configured)",
  });
});

server.registerTool("get_stats", {
  title: "Get vault stats",
  description: "Quick overview: note count by kind, folders, resolved vs unresolved links. Cheap way to monitor vault health.",
  inputSchema: z.object({}),
}, () => {
  if (!authorize("notes:read")) return deny();
  const notes = listNotes();
  const byKind: Record<string, number> = {};
  for (const n of notes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const folders = new Set(notes.map((n) => n.folder));
  const all = getDb().prepare(`SELECT COUNT(*) AS c FROM links`).get() as { c: number };
  const unresolved = getDb().prepare(`SELECT COUNT(*) AS c FROM links WHERE target_id IS NULL`).get() as { c: number };
  return ok({ notes: notes.length, by_kind: byKind, folders: folders.size, links: all.c, unresolved_links: unresolved.c });
});

// ---------- main ----------

const transport = new StdioServerTransport();
await server.connect(transport);

// keep the process alive for stdio
if (typeof process !== "undefined" && process.stdin) {
  process.stdin.resume();
}