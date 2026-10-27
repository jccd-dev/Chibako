import { createHash } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { applyFrontmatter } from "../../lib/markdown";
import { deleteNote, getNote, restoreNote, updateNote, type Note } from "../../lib/notes";
import type { ApiKeyPrincipal } from "../../server/auth/api-key-authorization";
import { getMemoryStatus, memoryProject, memoryRevision, writeMemory } from "./memory";
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

/** The registered note, including a trashed one, or null when the owner moved, renamed or purged it. */
function inPlace(record: SessionRecord): Note | null {
  const note = getNote(record.note_id, true);
  return note && note.folder === record.folder && note.title === record.title ? note : null;
}

function sessionRevision(record: SessionRecord, note: Note): string {
  return hash([memoryRevision(note), note.deleted_at, record.closed_at]);
}

/** The single active-work index at the area root; entries are `- [[Checkpoint]] (project) — next action`. */
const AGENT_NOW = { subject: "Agent Now", title: "Agent Now", lines: 15 };
const nowKey = (line: string) => line.slice(0, line.indexOf("]]") + 2);
const inArea = "(folder = ? OR (folder >= ? AND folder < ?))";
const areaArgs = (area: string) => [area, `${area}/`, `${area}0`];

function updateNow(principal: ApiKeyPrincipal, area: string, project: string | undefined, input: Exclude<SessionMemoryInput, { action: "read" | "continue" }>, title: string): void {
  const db = getDb();
  const record = db.prepare("SELECT note_id, folder, title, closed_at FROM memory_records WHERE folder = ? AND role = 'overview' AND subject = ? AND owner_id = 'shared'")
    .get(area, AGENT_NOW.subject) as SessionRecord | undefined;
  let note = record ? inPlace(record) : null;
  // Agent Now is managed by memory: a trashed index is restored, and one the owner moved or renamed
  // is left as a plain note while a fresh index starts, so no save is blocked by the index.
  if (note?.deleted_at != null) note = restoreNote(note.id);
  else if (record && !note) db.prepare("DELETE FROM memory_records WHERE note_id = ?").run(record.note_id);
  // Earlier releases kept one "Now" per project folder; fold them into Agent Now and trash them.
  const legacy = db.prepare(`SELECT r.note_id, r.folder, r.title, r.closed_at FROM memory_records r JOIN notes n ON n.id = r.note_id WHERE ${inArea.replaceAll("folder", "r.folder")} AND r.role = 'overview' AND r.subject = 'Now' AND r.owner_id = 'shared' ORDER BY n.updated_at DESC`)
    .all(...areaArgs(area)) as SessionRecord[];
  const legacyNotes = legacy.map(item => getNote(item.note_id)).filter((item, index): item is Note => item?.folder === legacy[index].folder && item.title === legacy[index].title);
  if (!note && !legacyNotes.length && input.action === "finish") return;
  const lines = (note?.content ?? "").split("\n");
  const head = lines.filter(line => !line.startsWith("- [[")).join("\n").trim();
  const migrated = legacyNotes.flatMap(item => {
    const tag = memoryProject(area, item.folder);
    return item.content.split("\n").filter(line => line.startsWith("- [[")).map(line => tag ? line.replace("]]", `]] (${tag})`) : line);
  });
  const seen = new Set([`- [[${title}]]`]);
  const entries = [...lines.filter(line => line.startsWith("- [[")), ...migrated].filter(line => !seen.has(nowKey(line)) && Boolean(seen.add(nowKey(line))));
  if (input.action === "save") entries.unshift(`- [[${title}]]${project ? ` (${project})` : ""} — ${input.now_line}`);
  const kept = entries.slice(0, AGENT_NOW.lines);
  const content = `${head ? `${head}\n\n` : ""}${kept.join("\n")}\n`;
  if (content !== note?.content) {
    writeMemory(principal, {
      request_id: `session-now-${hash([principal.id, input]).slice(0, 40)}`,
      role: "overview", subject: AGENT_NOW.subject, session_id: input.session_id, title: AGENT_NOW.title, content,
      expected_revision: note ? memoryRevision(note) : null,
    });
  }
  // Trash a legacy Now only when Agent Now now holds everything in it; otherwise it stays as a plain note.
  const keys = new Set(kept.map(nowKey));
  for (const item of legacyNotes) {
    const lines = item.content.split("\n").map(line => line.trim()).filter(Boolean);
    if (lines.every(line => /^# Now$/.test(line) || (line.startsWith("- [[") && keys.has(nowKey(line))))) deleteNote(item.id);
  }
  for (const item of legacy) db.prepare("DELETE FROM memory_records WHERE note_id = ?").run(item.note_id);
}

/** Links this session to another session's checkpoint (active or finished) so both keep saving into one note. */
function continueCheckpoint(area: string, current: SessionRecord | undefined, currentNote: Note | null, ownerId: string, subject: string, title: string): string {
  const db = getDb();
  const targets = db.prepare(`SELECT note_id, folder, title, closed_at FROM memory_records WHERE ${inArea} AND role = 'session' AND title = ?`)
    .all(...areaArgs(area), title) as SessionRecord[];
  if (targets.length !== 1) {
    throw new MemoryError(targets.length ? "Several checkpoints share this title; owner review required" : "No session checkpoint has this title", targets.length ? 409 : 404, "ineligible_note");
  }
  const target = targets[0];
  if (registeredNote(target).deleted_at != null) throw new MemoryError("That checkpoint is in Trash", 409, "ineligible_note");
  if (current && current.note_id !== target.note_id && current.closed_at == null && currentNote?.deleted_at == null) {
    throw new MemoryError("This session already has an active checkpoint; finish it before continuing another", 409, "session_active");
  }
  db.prepare("INSERT INTO memory_session_links (owner_id, subject, note_id, created_at) VALUES (?,?,?,?) ON CONFLICT (owner_id, subject) DO UPDATE SET note_id = excluded.note_id, created_at = excluded.created_at")
    .run(ownerId, subject, target.note_id, now());
  return target.note_id;
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
    // A continued checkpoint (shared with the session that created it) takes precedence over this session's own.
    const ownerId = JSON.stringify([principal.id, input.session_id]);
    const subject = `session:${input.runtime}`;
    let linked = db.prepare(`SELECT r.note_id, r.folder, r.title, r.closed_at FROM memory_session_links l JOIN memory_records r ON r.note_id = l.note_id WHERE l.owner_id = ? AND l.subject = ? AND ${inArea.replaceAll("folder", "r.folder")}`)
      .get(ownerId, subject, ...areaArgs(area)) as SessionRecord | undefined;
    // The owner moved or renamed the shared note: drop the link and fall back to this session's own checkpoint.
    if (linked && !inPlace(linked)) {
      db.prepare("DELETE FROM memory_session_links WHERE owner_id = ? AND subject = ?").run(ownerId, subject);
      linked = undefined;
    }
    const record = linked ?? db.prepare(`SELECT note_id, folder, title, closed_at FROM memory_records WHERE ${inArea} AND role = 'session' AND subject = ? AND owner_id = ?`)
      .get(...areaArgs(area), subject, ownerId) as SessionRecord | undefined;
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
    // Finished checkpoints stay as session records; only a trashed one reads as absent.
    if (input.action === "read") return { note: note?.deleted_at != null ? null : note, revision: currentRevision, closed };
    let noteId = note?.id ?? null;
    let retainedNoteId: string | null = null;
    if (input.action === "continue") noteId = continueCheckpoint(area, record, note, ownerId, subject, input.title);
    else if (currentRevision !== input.expected_revision) {
      // Name the expected value: agents otherwise invent placeholder hashes for a new checkpoint.
      throw new MemoryError(currentRevision === null
        ? "No session checkpoint exists yet; use expected_revision null to create it"
        : `Session memory is at revision ${currentRevision}; read it, merge, and retry with that expected_revision`, 409, "revision_conflict");
    }
    else if (input.action === "save") {
      if (record?.closed_at === null && note?.deleted_at != null) throw new MemoryError("Session checkpoint is in Trash; finish its cleanup or restore it before saving", 409, "ineligible_note");
      // Finished checkpoints are kept records; older clients would overwrite them without merging.
      if (record?.closed_at != null && note?.deleted_at == null && !input.reopen) {
        throw new MemoryError("This checkpoint is finished and kept as a record; read it, merge, and save with reopen", 409, "reopen_required");
      }
      if (record?.closed_at != null && note) restoreNote(note.id);
      // status reuses the vault property dictionary so checkpoints can be filtered with prop_key/prop_value.
      const content = applyFrontmatter(input.content, { status: "active" });
      const title = record?.title ?? `${input.title.slice(0, 87)} (${input.runtime}-${hash([principal.id, input.session_id]).slice(0, 12)})`;
      if (linked && note) {
        // Revision already checked above; the record belongs to the session that created it.
        if (note.content !== content) updateNote(note.id, { content });
      } else {
        noteId = writeMemory(principal, {
          request_id: `session-save-${hash([principal.id, input]).slice(0, 40)}`,
          project, role: "session", subject, session_id: input.session_id,
          title, content, expected_revision: note ? memoryRevision(note) : null,
        }).note_id;
      }
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
        // The checkpoint is kept as a session record; owner-invoked cleanup decides what to remove.
        updateNow(principal, area, project, input, record.title);
        if (note.deleted_at == null) updateNote(note.id, { properties: { status: "done" } });
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
