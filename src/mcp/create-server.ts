import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
} from "../lib/recall";
import { reindexEmbeddings, embeddingStatus } from "../lib/embedding-index";
import { getKnowledgeSchema } from "../features/schema/knowledge-schema";
import { getVaultStats } from "../features/graph/vault-stats";
import { hasAnyScope } from "../server/auth/api-key-authorization";

export interface McpServerOptions {
  scopes: readonly string[] | null;
  exposure: "local" | "remote";
}
function deny(): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: "unauthorized: API key lacks the required scope" }], isError: true };
}

function ok(data: object) {
  const structuredContent = { ...data };
  const text = JSON.stringify(structuredContent, null, 2);
  if (Buffer.byteLength(text) > 512 * 1024) {
    return fail("result exceeds 512 KiB; narrow the query or use pagination");
  }
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

function fail(msg: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: `error: ${msg}` }], isError: true };
}

const str = z.string().max(200_000);

const idOrTitle = { id: str.optional(), title: str.optional() };

/** Frontmatter-safe property value: scalar, string list, or null (delete key). */
const propValue = z.union([str, z.number(), z.boolean(), z.array(str), z.null()]);
const propPatch = z.record(str, propValue);

function propFilters(args: { prop_key?: string; prop_value?: string }): PropertyFilter[] {
  if (args.prop_key && args.prop_value) return [{ key: args.prop_key, value: args.prop_value }];
  return [];
}

function noteFor(args: { id?: string; title?: string }) {
  return args.id ? getNote(args.id) : args.title ? getNoteByTitle(args.title) : null;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MUTATING = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export function createMcpServer(options: McpServerOptions): McpServer {
  const authorized = (required: readonly string[]) => options.scopes === null || hasAnyScope(options.scopes, required);
  const server = new McpServer(
    { name: "chibako", version: "0.1.0" },
    { instructions: "Start with get_knowledge_schema. Use recall or search_notes before loading full notes, prefer ingest_note for context, and only use write tools when the user intends to change the Vault." },
  );

if (authorized(["notes:read"])) server.registerTool("list_notes", {
  title: "List notes",
  description: "List all notes. Returns only ids, titles, folders and kinds — a tiny payload, ideal for building an index. Optionally filter by folder, kind (note|wiki|index), or a property (prop_key + prop_value, substring match; tags match any item).",
  inputSchema: z.object({ folder: str.optional(), kind: str.optional(), prop_key: str.optional(), prop_value: str.optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }).strict(),
  annotations: READ_ONLY,
}, (args: { folder?: string; kind?: string; prop_key?: string; prop_value?: string; limit?: number; offset?: number }) => {
  if (!authorized(["notes:read"])) return deny();
  let notes = listNotes();
  if (args.folder) notes = notes.filter((n) => n.folder.startsWith(args.folder!));
  if (args.kind) notes = notes.filter((n) => n.kind === args.kind);
  notes = filterByProperties(notes, propFilters(args));
  const total = notes.length;
  if (args.limit !== undefined || args.offset !== undefined) notes = notes.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 500));
  const result = { count: notes.length, notes: notes.map((n) => ({ ...n, properties: Object.keys(n.properties).length ? n.properties : undefined })) };
  return ok(args.limit !== undefined || args.offset !== undefined ? { ...result, total } : result);
});

if (authorized(["notes:read", "search:read"])) server.registerTool("search_notes", {
  title: "Search notes",
  description: "Full-text search across all note titles and content. Returns matching notes with a snippet. Use before read_note to locate the right note cheaply. Optionally narrow by a property (prop_key + prop_value).",
  inputSchema: z.object({ query: str, prop_key: str.optional(), prop_value: str.optional() }).strict(),
  annotations: READ_ONLY,
}, (args: { query: string; prop_key?: string; prop_value?: string }) => {
  if (!authorized(["notes:read", "search:read"])) return deny();
  const results = searchNotes(args.query, propFilters(args));
  return ok({ count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, folder: r.folder, snippet: r.snippet })) });
});

if (authorized(["notes:read", "search:read"])) server.registerTool("recall", {
  title: "Recall relevant context (token-budgeted)",
  description: "Semantic recall, the recommended way to load context. Always BM25-ranked; when embeddings are enabled (CHIBAKO_EMBEDDING_*) it fuses vector similarity too. Returns only ranked titles + trimmed snippets, capped at a token budget — never full note bodies. Use this instead of search_notes when you want context, not a full dump.",
  inputSchema: z.object({ query: str, limit: z.number().int().min(1).max(50).optional(), budget: z.number().int().min(100).max(20000).optional() }).strict(),
  annotations: READ_ONLY,
}, async (args: { query: string; limit?: number; budget?: number }) => {
  if (!authorized(["notes:read", "search:read"])) return deny();
  try {
    const items = await recall({ query: args.query, limit: args.limit, budget: args.budget, refreshStale: options.exposure === "local" });
    return ok({ count: items.length, results: items });
  } catch (e) {
    return fail(`recall failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

if (authorized(["notes:write"])) server.registerTool("memory_save", {
  title: "Save an observation/decision",
  description: "Persist an explicit observation, decision, or pattern into the vault's observation log. Attach note_id (a note id) when it relates to a specific note. The log is searchable context for future sessions. Use this when you learned something worth remembering that isn't a full note.",
  inputSchema: z.object({ content: str, note_id: str.optional(), source: str.optional() }).strict(),
  annotations: MUTATING,
}, (args: { content: string; note_id?: string; source?: string }) => {
  if (!authorized(["notes:write"])) return deny();
  try {
    const obs = saveObservation({ content: args.content, note_id: args.note_id, source: args.source });
    return ok({ id: obs.id, note_id: obs.note_id, created_at: obs.created_at, saved: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});

if (authorized(["notes:read"])) server.registerTool("list_observations", {
  title: "List observations",
  description: "List recent entries from the observation log (decisions/patterns saved via memory_save), newest first. Optionally limit count.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
  annotations: READ_ONLY,
}, (args: { limit?: number }) => {
  if (!authorized(["notes:read"])) return deny();
  const list = listObservations(args.limit ?? 50);
  return ok({ count: list.length, observations: list });
});

if (authorized(["notes:write"])) server.registerTool("delete_observation", {
  title: "Delete an observation",
  description: "Remove one entry from the observation log by id.",
  inputSchema: z.object({ id: str }).strict(),
  annotations: DESTRUCTIVE,
}, (args: { id: string }) => {
  if (!authorized(["notes:write"])) return deny();
  if (!deleteObservation(args.id)) return fail("observation not found");
  return ok({ deleted: args.id });
});

if (options.exposure === "local" && authorized(["notes:write", "schema:write"])) server.registerTool("index_embeddings", {
  title: "Index note embeddings",
  description: "Build/refresh the vector embeddings index for semantic recall. Requires embeddings to be enabled via CHIBAKO_EMBEDDING_* env vars; otherwise this is a no-op. Works in capped batches and returns {indexed, skipped, remaining} — call again while remaining > 0 to finish a large backfill.",
  inputSchema: z.object({}).strict(),
  annotations: MUTATING,
}, async () => {
  if (!authorized(["notes:write", "schema:write"])) return deny();
  try {
    const res = await reindexEmbeddings();
    return ok(res);
  } catch (e) {
    return fail(`embedding indexing failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

if (authorized(["notes:read"])) server.registerTool("embedding_status", {
  title: "Embedding status",
  description: "Check whether semantic embeddings are enabled, the active provider/model/dimensions, how many notes are indexed, how many are stale, and the last error (if any).",
  inputSchema: z.object({}).strict(),
  annotations: READ_ONLY,
}, () => {
  if (!authorized(["notes:read"])) return deny();
  return ok(embeddingStatus());
});

if (authorized(["notes:read"])) server.registerTool("read_note", {
  title: "Read note",
  description: "Read one note by id or exact title. Returns the full note as plain Markdown with metadata (id, title, folder, kind). Prefer ingest_note to also get links in one call.",
  inputSchema: z.object(idOrTitle).strict(),
  annotations: READ_ONLY,
}, (args: { id?: string; title?: string }) => {
  if (!authorized(["notes:read"])) return deny();
  const note = noteFor(args);
  if (!note) return fail("note not found");
  return ok({ id: note.id, title: note.title, folder: note.folder, kind: note.kind, updated_at: note.updated_at, properties: note.properties, content: note.content });
});

if (authorized(["notes:read"])) server.registerTool("get_links", {
  title: "Get note links",
  description: "Outbound [[wikilinks]] and inbound backlinks for a note. Backlinks are computed from the whole vault. Returns titles/ids only to keep the payload small.",
  inputSchema: z.object(idOrTitle).strict(),
  annotations: READ_ONLY,
}, (args: { id?: string; title?: string }) => {
  if (!authorized(["notes:read"])) return deny();
  const note = noteFor(args);
  if (!note) return fail("note not found");
  const out = getOutlinks(note.id).map((l) => ({ target: l.target_title, resolved: Boolean(l.target_id), target_id: l.target_id }));
  const back = getBacklinks(note.title).map((b) => ({ id: b.id, title: b.title, folder: b.folder }));
  return ok({ note: note.title, outlinks: out, backlinks: back });
});

if (authorized(["notes:write"])) server.registerTool("create_note", {
  title: "Create note",
  description: "Create a new note. Title defaults to the first # heading if omitted. Content is plain Markdown; use [[Note Title]] to link to other notes. kind: note|wiki|index. properties: optional frontmatter values (e.g. { status: \"draft\", tags: [\"a\", \"b\"] }) — check get_property_defs for the vault's typed dictionary.",
  inputSchema: z.object({ title: str.optional(), folder: str.optional(), content: str, kind: str.optional(), properties: propPatch.optional() }).strict(),
  annotations: MUTATING,
}, (args: { title?: string; folder?: string; content: string; kind?: string; properties?: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorized(["notes:write"])) return deny();
  const kind = args.kind === "wiki" || args.kind === "index" ? args.kind : "note";
  const note = createNote({ title: args.title, folder: args.folder, content: args.content, kind, properties: args.properties });
  return ok({ id: note.id, title: note.title, folder: note.folder, properties: note.properties, created: true });
});

if (authorized(["notes:write"])) server.registerTool("update_note", {
  title: "Update note",
  description: "Update a note by id. Pass only the fields to change (title, folder, content, kind, properties). Renaming a title automatically re-points all [[backlinks]]. properties merges into the existing frontmatter (null removes a key). Returns the updated note.",
  inputSchema: z.object({ id: str, title: str.optional(), folder: str.optional(), content: str.optional(), kind: str.optional(), properties: propPatch.optional() }).strict(),
  annotations: MUTATING,
}, (args: { id: string; title?: string; folder?: string; content?: string; kind?: string; properties?: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorized(["notes:write"])) return deny();
  const kind = args.kind === "wiki" || args.kind === "index" ? args.kind : undefined;
  const updated = updateNote(args.id, { title: args.title, folder: args.folder, content: args.content, kind, properties: args.properties });
  if (!updated) return fail("note not found");
  return ok({ id: updated.id, title: updated.title, folder: updated.folder, properties: updated.properties, updated_at: updated.updated_at, saved: true });
});

if (authorized(["notes:write"])) server.registerTool("set_properties", {
  title: "Set note properties",
  description: "Set frontmatter properties on one note by id or title, merging with existing values (null removes a key). Typed definitions live in get_property_defs — prefer those keys and values for consistency.",
  inputSchema: z.object({ ...idOrTitle, properties: propPatch }).strict(),
  annotations: MUTATING,
}, (args: { id?: string; title?: string; properties: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorized(["notes:write"])) return deny();
  const note = noteFor(args);
  if (!note) return fail("note not found");
  const updated = updateNote(note.id, { properties: args.properties });
  if (!updated) return fail("note not found");
  return ok({ id: updated.id, title: updated.title, properties: updated.properties, saved: true });
});

if (authorized(["schema:read", "notes:read"])) server.registerTool("get_property_defs", {
  title: "Get property definitions",
  description: "The vault's typed property dictionary (name, type, allowed options). Read this once to learn which properties (e.g. status, tags, category) notes carry and which values are canonical.",
  inputSchema: z.object({}).strict(),
  annotations: READ_ONLY,
}, () => {
  if (!authorized(["schema:read", "notes:read"])) return deny();
  return ok({ properties: getPropertyDefs() });
});

if (authorized(["notes:write"])) server.registerTool("delete_note", {
  title: "Delete note",
  description: "Move a note to Trash by id or title. Recoverable for 30 days via restore_note. Only call this when the user explicitly confirms deletion.",
  inputSchema: z.object(idOrTitle).strict(),
  annotations: MUTATING,
}, (args: { id?: string; title?: string }) => {
  if (!authorized(["notes:write"])) return deny();
  const note = noteFor(args);
  if (!note) return fail("note not found");
  deleteNote(note.id);
  return ok({ trashed: note.title });
});

if (authorized(["notes:write"])) server.registerTool("restore_note", {
  title: "Restore note",
  description: "Restore a trashed note by id. Returns the restored note.",
  inputSchema: z.object({ id: str }).strict(),
  annotations: MUTATING,
}, (args: { id: string }) => {
  if (!authorized(["notes:write"])) return deny();
  const note = restoreNote(args.id);
  if (!note) return fail("note not found in trash");
  return ok({ id: note.id, title: note.title, restored: true });
});

if (authorized(["notes:purge"])) server.registerTool("purge_note", {
  title: "Purge note permanently",
  description: "Permanently delete a trashed note by id. Destructive and irreversible. Only call this when the user explicitly confirms permanent deletion.",
  inputSchema: z.object({ id: str }).strict(),
  annotations: DESTRUCTIVE,
}, (args: { id: string }) => {
  if (!authorized(["notes:purge"])) return deny();
  if (!purgeNote(args.id)) return fail("note not found");
  return ok({ purged: args.id });
});

if (authorized(["notes:read"])) server.registerTool("get_graph", {
  title: "Get graph",
  description: "All vault nodes (notes) and edges (resolved wikilinks). Useful for understanding the shape of the knowledge base or finding orphaned notes.",
  inputSchema: z.object({ folder: str.optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }).strict(),
  annotations: READ_ONLY,
}, (args: { folder?: string; limit?: number; offset?: number }) => {
  if (!authorized(["notes:read"])) return deny();
  const g = graphData();
  const byId = new Map(g.nodes.map((n) => [n.id, n.title]));
  let nodes = args.folder ? g.nodes.filter((node) => node.folder.startsWith(args.folder!)) : g.nodes;
  const total = nodes.length;
  if (args.limit !== undefined || args.offset !== undefined) nodes = nodes.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 500));
  const ids = new Set(nodes.map((node) => node.id));
  const links = g.links.filter((link) => ids.has(link.source));
  const result = {
    node_count: nodes.length,
    link_count: links.length,
    notes: nodes.map((n) => ({ id: n.id, title: n.title, folder: n.folder, kind: n.kind })),
    links: links.map((l) => ({ source: byId.get(l.source) ?? l.source, target: byId.get(l.target) ?? l.target })),
  };
  return ok(args.limit !== undefined || args.offset !== undefined ? { ...result, total_nodes: total } : result);
});

if (authorized(["schema:read"])) server.registerTool("get_knowledge_schema", {
  title: "Get knowledge schema",
  description: "Read the AGENTS.md brain instructions for this vault: how to categorize, link, compile wiki pages, and handle contradictions. Read this once at the start of a session.",
  inputSchema: z.object({}).strict(),
  annotations: READ_ONLY,
}, () => {
  if (!authorized(["schema:read"])) return deny();
  return ok({ schema: getKnowledgeSchema() });
});

if (authorized(["notes:read"])) server.registerTool("ingest_note", {
  title: "Ingest note (token-efficient)",
  description: "The recommended single call for loading context about one note: returns the note content plus its outlinks/backlinks plus the knowledge schema in one round trip. Use this instead of read_note + get_links + get_knowledge_schema.",
  inputSchema: z.object(idOrTitle).strict(),
  annotations: READ_ONLY,
}, (args: { id?: string; title?: string }) => {
  if (!authorized(["notes:read"])) return deny();
  const note = noteFor(args);
  if (!note) return fail("note not found");
  const out = getOutlinks(note.id).map((l) => l.target_title);
  const back = getBacklinks(note.title).map((b) => ({ id: b.id, title: b.title }));
  const schema = getKnowledgeSchema();
  return ok({
    note: { id: note.id, title: note.title, folder: note.folder, kind: note.kind, updated_at: note.updated_at, properties: note.properties, content: note.content },
    outlinks: out,
    backlinks: back,
    schema,
  });
});

if (authorized(["notes:read"])) server.registerTool("get_stats", {
  title: "Get vault stats",
  description: "Quick overview: note count by kind, folders, resolved vs unresolved links. Cheap way to monitor vault health.",
  inputSchema: z.object({}).strict(),
  annotations: READ_ONLY,
}, () => {
  if (!authorized(["notes:read"])) return deny();
  return ok(getVaultStats());
});

  return server;
}
