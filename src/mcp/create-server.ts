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
  NOTE_KINDS,
  type NoteKind,
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
import { authorizeFinance } from "../server/auth/finance-authorization";
import { createAccount, getAccount, listAccounts, updateAccount, getFinanceSummary } from "../features/finance/accounts";
import { postTransaction, listTransactions, getTransaction, getActivityTotals } from "../features/finance/activity";
import { postTransfer, reconcileAccount, valueAsset } from "../features/finance/movements";
import { correctActivity, hideActivity, revertActivity, recordRefund } from "../features/finance/corrections";
import { correctActivitySchema, activityActionSchema, recordRefundSchema } from "../features/finance/correction-types";
import { postTransferSchema, postAdjustmentSchema } from "../features/finance/movement-types";
import { createClassification, updateClassification, listClassifications } from "../features/finance/classifications";
import { postTransactionSchema, listTransactionsSchema, getTransactionSchema, activityTotalsSchema, createClassificationSchema, updateClassificationSchema, listClassificationsSchema } from "../features/finance/activity-types";
import { createAccountSchema, updateAccountSchema, getAccountSchema, listAccountsSchema, FinanceError, type FinanceActor, type FinanceScope } from "../features/finance/types";

export interface McpServerOptions {
  scopes: readonly string[] | null;
  exposure: "local" | "remote";
  financeActor?: FinanceActor;
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
  const authorized = (required: readonly string[]) => (options.exposure === "local" && options.scopes === null) || (options.scopes !== null && hasAnyScope(options.scopes, required));
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
  description: "Create a new note. Title defaults to the first # heading if omitted. Content is plain Markdown; use [[Note Title]] to link to other notes. kind: note|wiki|index. properties: optional frontmatter values (e.g. { layer: \"raw\", type: \"concept\", tags: [\"a\", \"b\"] }) — check get_property_defs for the vault's typed dictionary.",
  inputSchema: z.object({ title: str.optional(), folder: str.optional(), content: str, kind: z.enum(NOTE_KINDS).optional(), properties: propPatch.optional() }).strict(),
  annotations: MUTATING,
}, (args: { title?: string; folder?: string; content: string; kind?: NoteKind; properties?: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorized(["notes:write"])) return deny();
  const note = createNote({ title: args.title, folder: args.folder, content: args.content, kind: args.kind, properties: args.properties });
  return ok({ id: note.id, title: note.title, folder: note.folder, properties: note.properties, created: true });
});

if (authorized(["notes:write"])) server.registerTool("update_note", {
  title: "Update note",
  description: "Update a note by id. Pass only the fields to change (title, folder, content, kind, properties). Renaming a title automatically re-points all [[backlinks]]. properties merges into the existing frontmatter (null removes a key). Returns the updated note.",
  inputSchema: z.object({ id: str, title: str.optional(), folder: str.optional(), content: str.optional(), kind: z.enum(NOTE_KINDS).optional(), properties: propPatch.optional() }).strict(),
  annotations: MUTATING,
}, (args: { id: string; title?: string; folder?: string; content?: string; kind?: NoteKind; properties?: Record<string, string | number | boolean | string[] | null> }) => {
  if (!authorized(["notes:write"])) return deny();
  const updated = updateNote(args.id, { title: args.title, folder: args.folder, content: args.content, kind: args.kind, properties: args.properties });
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

  const financeActor: FinanceActor | undefined = options.scopes === null
    ? options.exposure === "local" ? { kind: "trusted-local" } : undefined
    : options.financeActor?.kind === "api-key"
      ? { kind: "api-key", id: options.financeActor.id, scopes: options.scopes }
      : undefined;
  const financeAuthorized = (scope: FinanceScope) => {
    if (!financeActor) return false;
    try { authorizeFinance(financeActor, scope); return true; } catch { return false; }
  };
  const financeResult = (scope: FinanceScope, operation: (actor: FinanceActor) => object) => {
    if (!financeActor || !financeAuthorized(scope)) return deny();
    try { return ok(operation(financeActor)); } catch (error) {
      if (error instanceof FinanceError) return fail(`${error.code}: ${error.message}`);
      console.error(error);
      return fail("internal_error: Finance operation failed");
    }
  };
  if (financeAuthorized("finance:read")) {
    server.registerTool("list_finance_activity", {
      title: "Finance activity", description: "Bounded dated activity including refunds, transfers and adjustments. Hidden and reverted records require explicit hidden/reverted filters (false, true, all). Search by date, account, category, type or text/tag. Compact by default; explicitly request include_details for text, tags and timestamps.",
      inputSchema: listTransactionsSchema, annotations: READ_ONLY,
    }, args => financeResult("finance:read", actor => ({ ...listTransactions(actor, args) })));
    server.registerTool("get_finance_transaction", {
      title: "Inspect finance transaction", description: "Inspect one posted transaction. Personal text and tags require include_details: true.",
      inputSchema: getTransactionSchema, annotations: READ_ONLY,
    }, ({ id, ...args }) => financeResult("finance:read", actor => ({ transaction: getTransaction(actor, id, args) })));
    server.registerTool("get_finance_activity_totals", {
      title: "Monthly finance totals", description: "Exact PHP income and spending by transaction calendar month (YYYY-MM), defaulting to this month. Excludes openings and assets.",
      inputSchema: activityTotalsSchema, annotations: READ_ONLY,
    }, args => financeResult("finance:read", actor => ({ ...getActivityTotals(actor, args) })));
    server.registerTool("list_finance_classifications", {
      title: "Finance categories and tags", description: "Bounded categories, subcategories and tags. Income and expense types remain separate; archived entries require an explicit filter.",
      inputSchema: listClassificationsSchema, annotations: READ_ONLY,
    }, args => financeResult("finance:read", actor => ({ ...listClassifications(actor, args) })));
    server.registerTool("list_finance_accounts", {
      title: "List finance accounts", description: "Bounded PHP accounts with exact cent balances. Defaults to active accounts, 50 per page; filter archived or kind explicitly.",
      inputSchema: listAccountsSchema, annotations: READ_ONLY,
    }, args => financeResult("finance:read", actor => ({ ...listAccounts(actor, args) })));
    server.registerTool("get_finance_account", {
      title: "Read finance account", description: "Read one PHP account, immutable opening, derived balance and current version.",
      inputSchema: getAccountSchema, annotations: READ_ONLY,
    }, args => financeResult("finance:read", actor => ({ account: getAccount(actor, args.id) })));
    server.registerTool("get_finance_summary", {
      title: "Finance summary", description: "Separate money and asset totals in PHP integer cents, including archived holdings. Openings do not count as income or spending.",
      inputSchema: z.object({}).strict(), annotations: READ_ONLY,
    }, () => financeResult("finance:read", actor => ({ ...getFinanceSummary(actor) })));
  }
  if (financeAuthorized("finance:write")) {
    const annotations = { ...MUTATING, idempotentHint: true };
    server.registerTool("correct_finance_activity", {
      title: "Correct finance activity", description: "Replace mistaken amount, account, date or details atomically. Amount is a PHP decimal; adjustments accept a signed difference, not a new target balance. Transfer source is account_id, destination is destination_account_id; a linked fee moves with it. Optional fee correction requires its version. Refunds retain their expense/category link. Requires current version and request_id; returns affected balances.",
      inputSchema: correctActivitySchema.safeExtend({ id: getAccountSchema.shape.id }), annotations,
    }, ({ id, ...args }) => financeResult("finance:write", actor => ({ ...correctActivity(actor, id, args) })));
    server.registerTool("hide_finance_activity", {
      title: "Delete finance activity (hide only)", description: "Hide a record from default Activity without cancelling balances or reports. Transfer fee hides with its transfer. Requires current version and request_id. Inspect with hidden filters.",
      inputSchema: activityActionSchema.extend({ id: getAccountSchema.shape.id }), annotations,
    }, ({ id, ...args }) => financeResult("finance:write", actor => ({ ...hideActivity(actor, id, args) })));
    server.registerTool("revert_finance_activity", {
      title: "Revert mistaken finance activity", description: "Cancel financial/reporting effects once, including a transfer's linked fee. Revert active refunds before their expense (including fees). Refund reversion cancels its own credit and spending reduction. Requires current version and request_id; identical retries return the original result.",
      inputSchema: activityActionSchema.extend({ id: getAccountSchema.shape.id }), annotations,
    }, ({ id, ...args }) => financeResult("finance:write", actor => ({ ...revertActivity(actor, id, args) })));
    server.registerTool("record_finance_refund", {
      title: "Record a dated expense refund", description: "Link a full/partial positive PHP refund to expense id, credit its receiving money account, and reduce spending in the expense category on transaction_date, never as income. Active totals cannot exceed the expense. Requires expense version and request_id; increments expense version.",
      inputSchema: recordRefundSchema.extend({ id: getAccountSchema.shape.id }), annotations,
    }, ({ id, ...args }) => financeResult("finance:write", actor => ({ ...recordRefund(actor, id, args) })));
    server.registerTool("post_finance_transfer", {
      title: "Transfer money", description: "Atomically move a positive PHP amount between two active money accounts. Optional categorized fee is a linked expense deducted from the source. Requires request_id and calendar transaction_date. Returns both resulting balances; transfers never count as income or spending.",
      inputSchema: postTransferSchema, annotations,
    }, args => financeResult("finance:write", actor => ({ ...postTransfer(actor, args) })));
    server.registerTool("reconcile_finance_account", {
      title: "Reconcile money account", description: "Compare actual_balance (signed PHP decimal) to expected_balance_cents from a recent read. Append the dated difference, never overwrite the opening. Reject a changed balance. Requires request_id and transaction_date. Excluded from income/spending.",
      inputSchema: postAdjustmentSchema, annotations,
    }, args => financeResult("finance:write", actor => ({ ...reconcileAccount(actor, args) })));
    server.registerTool("value_finance_asset", {
      title: "Adjust asset valuation", description: "Record actual_balance as the new tracked asset value by appending a dated difference from expected_balance_cents. Active asset accounts only, no cash or income/spending effects. Requires request_id and transaction_date.",
      inputSchema: postAdjustmentSchema, annotations,
    }, args => financeResult("finance:write", actor => ({ ...valueAsset(actor, args) })));
    server.registerTool("post_finance_transaction", {
      title: "Record income or expense", description: "Post actual PHP activity to an active money account. Requires request_id, decimal-string amount and transaction_date; defaults to Expense. Returns original balance on retries and warns on negative balances without blocking.",
      inputSchema: postTransactionSchema, annotations,
    }, args => financeResult("finance:write", actor => ({ ...postTransaction(actor, args) })));
  }
  if (financeAuthorized("finance:manage")) {
    const annotations = { ...MUTATING, idempotentHint: true };
    server.registerTool("create_finance_classification", {
      title: "Create category or tag", description: "Create a typed income/expense category, one-level subcategory or untyped tag. Requires request_id.",
      inputSchema: createClassificationSchema, annotations,
    }, args => financeResult("finance:manage", actor => createClassification(actor, args)));
    server.registerTool("update_finance_classification", {
      title: "Manage category or tag", description: "Rename or archive a classification, preserving history. Requires request_id and current version.",
      inputSchema: updateClassificationSchema.safeExtend({ id: getAccountSchema.shape.id }), annotations,
    }, ({ id, ...args }) => financeResult("finance:manage", actor => updateClassification(actor, id, args)));
    server.registerTool("create_finance_account", {
      title: "Create finance account", description: "Create a PHP money or asset account with an exact decimal-string opening_balance. Requires request_id; identical retries return the original account.",
      inputSchema: createAccountSchema, annotations,
    }, args => financeResult("finance:manage", actor => createAccount(actor, args)));
    server.registerTool("update_finance_account", {
      title: "Manage finance account", description: "Rename or archive an account. Requires request_id and current version; opening, currency and kind cannot change. Archive preserves holdings.",
      inputSchema: updateAccountSchema.safeExtend({ id: getAccountSchema.shape.id }), annotations,
    }, ({ id, ...args }) => financeResult("finance:manage", actor => updateAccount(actor, id, args)));
  }
  return server;
}
