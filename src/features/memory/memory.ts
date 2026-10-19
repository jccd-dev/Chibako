import { createHash } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { createNote, getNote, getNoteByPath, updateNote, type Note } from "../../lib/notes";
import { normalizeFolder } from "../organization/folders";
import type { ApiKeyPrincipal } from "../../server/auth/api-key-authorization";
import { MemoryError, memoryReadSchema, memoryWriteSchema, type MemoryWriteInput } from "./types";

interface MemoryRecord {
  note_id: string;
  folder: string;
  title: string;
}
export interface MemoryReceipt {
  note_id: string;
  revision: string;
  request_id: string;
  saved: true;
}

export function getMemoryStatus(principal: ApiKeyPrincipal): {
  contract_version: 1; principal_id: string; scopes: string[]; enabled: boolean; area: string | null;
} {
  if (!principal.id || !principal.scopes.includes("memory:write")) {
    throw new MemoryError("Forbidden: missing memory:write scope", 403, "forbidden");
  }
  const configured = process.env.CHIBAKO_MEMORY_FOLDER;
  const area = configured ? normalizeFolder(configured) : null;
  return { contract_version: 1, principal_id: principal.id, scopes: [...principal.scopes], enabled: Boolean(area), area: area || null };
}

function authorize(principal: ApiKeyPrincipal): string {
  if (!principal.id || !principal.scopes.includes("memory:write")) {
    throw new MemoryError("Forbidden: missing memory:write scope", 403, "forbidden");
  }
  const configured = process.env.CHIBAKO_MEMORY_FOLDER;
  if (!configured) throw new MemoryError("Automatic memory is disabled", 403, "memory_disabled");
  const folder = normalizeFolder(configured);
  if (!folder) throw new MemoryError("A non-root memory folder is required", 403, "memory_disabled");
  return folder;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function revision(note: Note): string {
  return hash([note.id, note.title, note.folder, note.content, note.kind, note.is_pinned]);
}

function owner(principal: ApiKeyPrincipal, input: { role: string; session_id: string }): string {
  return input.role === "session" ? JSON.stringify([principal.id, input.session_id]) : "shared";
}

function findRecord(folder: string, role: string, subject: string, ownerId: string): MemoryRecord | undefined {
  return getDb().prepare("SELECT note_id, folder, title FROM memory_records WHERE folder = ? AND role = ? AND subject = ? AND owner_id = ?")
    .get(folder, role, subject, ownerId) as MemoryRecord | undefined;
}

function eligibleNote(record: MemoryRecord): Note {
  const note = getNote(record.note_id);
  if (!note || note.folder !== record.folder || note.title !== record.title) {
    throw new MemoryError("Memory note was removed or relocated; owner review required", 409, "ineligible_note");
  }
  return note;
}

export function readMemory(principal: ApiKeyPrincipal, raw: unknown): { note: Note; revision: string } | { note: null; revision: null } {
  const folder = authorize(principal);
  if (!principal.scopes.includes("notes:read") && !principal.scopes.includes("*")) {
    throw new MemoryError("Forbidden: missing notes:read scope", 403, "forbidden");
  }
  const parsed = memoryReadSchema.safeParse(raw);
  if (!parsed.success) throw new MemoryError("Invalid memory query", 400, "invalid_input");
  const input = parsed.data;
  return getDb().transaction(() => {
    const record = findRecord(folder, input.role, input.subject, owner(principal, input));
    if (!record) return { note: null, revision: null };
    const note = eligibleNote(record);
    return { note, revision: revision(note) };
  })();
}

export function writeMemory(principal: ApiKeyPrincipal, raw: unknown): MemoryReceipt {
  const folder = authorize(principal);
  const parsed = memoryWriteSchema.safeParse(raw);
  if (!parsed.success) throw new MemoryError("Invalid memory checkpoint", 400, "invalid_input");
  const input = parsed.data;
  if (input.role === "preference" && !input.confirmation) {
    throw new MemoryError("Preferences require a confirmation source and scope", 400, "confirmation_required");
  }
  return getDb().transaction(() => persist(principal, folder, input)).immediate();
}

function persist(principal: ApiKeyPrincipal, folder: string, input: MemoryWriteInput): MemoryReceipt {
  const db = getDb();
  const fingerprint = hash([folder, input.request_id, input.role, input.subject, input.session_id, input.title, input.content, input.expected_revision, input.confirmation ?? null]);
  const previous = db.prepare("SELECT fingerprint, note_id, revision FROM memory_requests WHERE actor_id = ? AND request_id = ?")
    .get(principal.id, input.request_id) as { fingerprint: string; note_id: string; revision: string } | undefined;
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new MemoryError("Request identity reused with different content", 409, "request_conflict");
    return { note_id: previous.note_id, revision: previous.revision, request_id: input.request_id, saved: true };
  }
  const ownerId = owner(principal, input);
  const record = findRecord(folder, input.role, input.subject, ownerId);
  let note: Note;
  if (record) {
    const existing = eligibleNote(record);
    if (input.title !== existing.title) throw new MemoryError("Automatic memory cannot rename notes", 409, "ineligible_note");
    if (revision(existing) !== input.expected_revision) throw new MemoryError("Reload current memory and merge before retrying", 409, "revision_conflict");
    note = existing.content === input.content ? existing : updateNote(existing.id, { content: input.content })!;
  } else {
    if (input.expected_revision !== null) throw new MemoryError("Memory does not exist", 409, "revision_conflict");
    if (getNoteByPath(folder, input.title) || db.prepare("SELECT 1 FROM notes WHERE folder = ? AND title = ?").get(folder, input.title)) {
      throw new MemoryError("Existing notes require explicit adoption; choose a new title", 409, "ineligible_note");
    }
    note = createNote({ folder, title: input.title, content: input.content, kind: input.role === "wiki" ? "wiki" : input.role === "overview" ? "index" : "note" });
    db.prepare("INSERT INTO memory_records (note_id, folder, title, role, subject, owner_id) VALUES (?,?,?,?,?,?)")
      .run(note.id, folder, note.title, input.role, input.subject, ownerId);
  }
  const result: MemoryReceipt = { note_id: note.id, revision: revision(note), request_id: input.request_id, saved: true };
  db.prepare("INSERT INTO memory_requests (actor_id, request_id, fingerprint, note_id, revision, session_id, confirmation_json, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(principal.id, input.request_id, fingerprint, note.id, result.revision, input.session_id, JSON.stringify(input.confirmation ?? null), now());
  return result;
}
