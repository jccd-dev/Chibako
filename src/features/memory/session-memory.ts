import { createHash } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { deleteNote, getNote, restoreNote, type Note } from "../../lib/notes";
import type { ApiKeyPrincipal } from "../../server/auth/api-key-authorization";
import { getMemoryStatus, memoryFolder, memoryProject, memoryRevision, writeMemory } from "./memory";
import { MemoryError, sessionMemorySchema, type SessionMemoryInput } from "./types";

interface SessionRecord {
  note_id: string;
  folder: string;
  title: string;
  closed_at: number | null;
}
export interface SessionMemoryReceipt {
  saved: true;
  request_id: string;
  note_id: string | null;
  revision: string | null;
  closed: boolean;
  retained_note_id: string | null;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function registeredNote(record: SessionRecord): Note {
  const note = getNote(record.note_id, true);
  if (!note || note.folder !== record.folder || note.title !== record.title) {
    throw new MemoryError("Session memory was removed or relocated; owner review required", 409, "ineligible_note");
  }
  return note;
}

function sessionRevision(record: SessionRecord, note: Note): string {
  return hash([memoryRevision(note), note.deleted_at, record.closed_at]);
}

function updateNow(principal: ApiKeyPrincipal, area: string, project: string | undefined, input: Exclude<SessionMemoryInput, { action: "read" }>, title: string): void {
  const db = getDb();
  const record = db.prepare("SELECT note_id, folder, title, closed_at FROM memory_records WHERE folder = ? AND role = 'overview' AND subject = 'Now' AND owner_id = 'shared'")
    .get(memoryFolder(area, project)) as SessionRecord | undefined;
  const note = record ? registeredNote(record) : null;
  if (!note && input.action === "finish") return;
  const lines = (note?.content ?? "").split("\n");
  const head = lines.filter(line => !line.startsWith("- [[")).join("\n").trim();
  const entries = lines.filter(line => line.startsWith("- [[") && !line.startsWith(`- [[${title}]]`));
  if (input.action === "save") entries.unshift(`- [[${title}]] — ${input.now_line}`);
  const content = `${head ? `${head}\n\n` : ""}${entries.slice(0, 15).join("\n")}\n`;
  if (content === note?.content) return;
  writeMemory(principal, {
    request_id: `session-now-${hash([principal.id, input]).slice(0, 40)}`,
    project, role: "overview", subject: "Now", session_id: input.session_id, title: "Now", content,
    expected_revision: note ? memoryRevision(note) : null,
  });
}

export function sessionMemory(principal: ApiKeyPrincipal, raw: unknown):
  { note: Note | null; revision: string | null; closed: boolean } | SessionMemoryReceipt {
  const status = getMemoryStatus(principal);
  if (!principal.scopes.includes("notes:read") && !principal.scopes.includes("*")) {
    throw new MemoryError("Forbidden: missing notes:read scope", 403, "forbidden");
  }
  if (!status.enabled || !status.area) throw new MemoryError("Automatic memory is disabled", 403, "memory_disabled");
  const parsed = sessionMemorySchema.safeParse(raw);
  if (!parsed.success) throw new MemoryError("Invalid session memory operation", 400, "invalid_input");
  const input = parsed.data;
  const area = status.area;
  const db = getDb();
  return db.transaction(() => {
    // Session identity spans the whole area: a checkpoint stays in the project folder where it was created.
    const record = db.prepare("SELECT note_id, folder, title, closed_at FROM memory_records WHERE (folder = ? OR (folder >= ? AND folder < ?)) AND role = 'session' AND subject = ? AND owner_id = ?")
      .get(area, `${area}/`, `${area}0`, `session:${input.runtime}`, JSON.stringify([principal.id, input.session_id])) as SessionRecord | undefined;
    const project = record ? memoryProject(area, record.folder) : input.project;
    if (input.action !== "read") {
      const previous = db.prepare("SELECT fingerprint, receipt_json FROM memory_session_requests WHERE actor_id = ? AND request_id = ?")
        .get(principal.id, input.request_id) as { fingerprint: string; receipt_json: string } | undefined;
      if (previous) {
        if (previous.fingerprint !== hash([area, input])) throw new MemoryError("Request identity reused with different content", 409, "request_conflict");
        return JSON.parse(previous.receipt_json) as SessionMemoryReceipt;
      }
    }
    const note = record ? registeredNote(record) : null;
    const currentRevision = record && note ? sessionRevision(record, note) : null;
    const closed = record?.closed_at != null || note?.deleted_at != null;
    if (input.action === "read") return { note: closed ? null : note, revision: currentRevision, closed };
    if (currentRevision !== input.expected_revision) throw new MemoryError("Read current session memory and merge before retrying", 409, "revision_conflict");
    let noteId = note?.id ?? null;
    let retainedNoteId: string | null = null;
    if (input.action === "save") {
      if (record?.closed_at === null && note?.deleted_at != null) throw new MemoryError("Session checkpoint is in Trash; finish its cleanup or restore it before saving", 409, "ineligible_note");
      if (record?.closed_at != null && note) restoreNote(note.id);
      const title = record?.title ?? `${input.title.slice(0, 87)} (${input.runtime}-${hash([principal.id, input.session_id]).slice(0, 12)})`;
      const receipt = writeMemory(principal, {
        request_id: `session-save-${hash([principal.id, input]).slice(0, 40)}`,
        project, role: "session", subject: `session:${input.runtime}`, session_id: input.session_id,
        title, content: input.content, expected_revision: note ? memoryRevision(note) : null,
      });
      noteId = receipt.note_id;
      db.prepare("UPDATE memory_records SET closed_at = NULL WHERE note_id = ?").run(noteId);
      updateNow(principal, area, project, input, title);
    } else {
      if (input.retain) {
        const receipt = writeMemory(principal, {
          ...input.retain, project: input.retain.project === null ? undefined : input.retain.project ?? project, request_id: `session-retain-${hash([principal.id, input]).slice(0, 40)}`, session_id: input.session_id,
        });
        retainedNoteId = receipt.note_id;
      }
      if (record && note) {
        updateNow(principal, area, project, input, record.title);
        deleteNote(note.id);
        db.prepare("UPDATE memory_records SET closed_at = COALESCE(closed_at, ?) WHERE note_id = ?").run(now(), note.id);
      }
    }
    const finalRecord = noteId ? db.prepare("SELECT note_id, folder, title, closed_at FROM memory_records WHERE note_id = ?").get(noteId) as SessionRecord : null;
    const finalNote = finalRecord ? registeredNote(finalRecord) : null;
    const receipt: SessionMemoryReceipt = {
      saved: true, request_id: input.request_id, note_id: noteId,
      revision: finalRecord && finalNote ? sessionRevision(finalRecord, finalNote) : null,
      closed: input.action === "finish", retained_note_id: retainedNoteId,
    };
    db.prepare("INSERT INTO memory_session_requests (actor_id, request_id, fingerprint, receipt_json, created_at) VALUES (?,?,?,?,?)")
      .run(principal.id, input.request_id, hash([area, input]), JSON.stringify(receipt), now());
    return receipt;
  }).immediate();
}
