import { createHash } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { applyFrontmatter } from "../../lib/markdown";
import { deleteNote, getNote, getNoteByPath, restoreNote, updateNote, type Note } from "../../lib/notes";
import type { ApiKeyPrincipal } from "../../server/auth/api-key-authorization";
import { getMemoryStatus, memoryFolder, memoryProject, memoryRevision, writeMemory } from "./memory";
import { MemoryError, sessionMemorySchema, type SessionMemoryInput } from "./types";
import { memoryStaleDays } from "./staleness";

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
  /** True when this request linked the session to a checkpoint it did not own (thread or workstream). */
  joined: boolean;
  title: string | null;
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

/** The single active-work index at the area root; older entries may have plain links, no project or no date. */
const AGENT_NOW = { subject: "Agent Now", title: "Agent Now", lines: 15 };
function nowTarget(line: string, area: string) {
  const match = /^- \[\[([^\]]+)\]\](?: \(([^)]+)\))?/.exec(line);
  const target = match?.[1] ?? "";
  const slash = target.lastIndexOf("/");
  const folder = slash < 0 ? memoryFolder(area, match?.[2]) : target.slice(0, slash);
  return { folder, title: target.slice(slash + 1) };
}
const nowKey = (line: string, area: string) => JSON.stringify(nowTarget(line, area));
const lineDate = (line: string) => /· (\d{4}-\d{2}-\d{2})$/.exec(line)?.[1];
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
  if (!note && !legacyNotes.length && input.action !== "save") return;
  const lines = (note?.content ?? "").split("\n");
  const head = lines.filter(line => !line.startsWith("- [[")).join("\n").trim();
  const migrated = legacyNotes.flatMap(item => {
    const tag = memoryProject(area, item.folder);
    return item.content.split("\n").filter(line => line.startsWith("- [[")).map(line => tag ? line.replace("]]", `]] (${tag})`) : line);
  });
  // Activity keeps the entry and only refreshes its date; save and finish replace or drop it.
  const target = `- [[${memoryFolder(area, project)}/${title}]]`;
  const key = nowKey(target, area);
  const seen = new Set(input.action === "activity" ? [] : [key]);
  const today = new Date().toISOString().slice(0, 10);
  const refresh = (line: string) => input.action === "activity" && nowKey(line, area) === key ? `${line.replace(/ · \d{4}-\d{2}-\d{2}$/, "")} · ${today}` : line;
  const cutoff = now() - memoryStaleDays() * 86_400;
  // An entry ages by the later of its checkpoint's last update and its line date (activity refreshes the date); a line with neither stays.
  const entries = [...lines.filter(line => line.startsWith("- [[")), ...migrated].filter(line => !seen.has(nowKey(line, area)) && Boolean(seen.add(nowKey(line, area))))
    .map(refresh).filter(line => {
      const { folder, title } = nowTarget(line, area);
      const target = db.prepare(`SELECT note_id, folder, title, closed_at FROM memory_records WHERE ${inArea} AND folder = ? AND role = 'session' AND title = ?`)
        .get(...areaArgs(area), folder, title) as SessionRecord | undefined;
      const checkpoint = target ? inPlace(target) : null;
      const date = lineDate(line);
      const updated = Math.max(checkpoint?.updated_at ?? -Infinity, date ? Date.parse(`${date}T00:00:00Z`) / 1000 : -Infinity);
      if (updated === -Infinity) return true;
      if (updated >= cutoff) return true;
      if (checkpoint?.deleted_at == null && checkpoint?.properties.status === "active") updateNote(checkpoint.id, { properties: { status: "stale" } });
      return false;
    });
  if (input.action === "save") entries.unshift(`${target}${project ? ` (${project})` : ""} — ${input.now_line} · ${today}`);
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
  const keys = new Set(kept.map(line => nowKey(line, area)));
  for (const item of legacyNotes) {
    const lines = item.content.split("\n").map(line => line.trim()).filter(Boolean);
    const tag = memoryProject(area, item.folder);
    if (lines.every(line => /^# Now$/.test(line) || (line.startsWith("- [[") && keys.has(nowKey(tag ? line.replace("]]", `]] (${tag})`) : line, area))))) deleteNote(item.id);
  }
  for (const item of legacy) db.prepare("DELETE FROM memory_records WHERE note_id = ?").run(item.note_id);
}

/** One bounded, metadata-only Activity note per project folder, newest line first. The area root keeps the plain title. */
const ACTIVITY = { subject: "Activity", title: "Activity", lines: 30 };
const activityTitle = (project: string | undefined) => project ? `${ACTIVITY.title} — ${project}` : ACTIVITY.title;

/** Ids of the managed bookkeeping notes (Agent Now and every project's Activity); Recall leaves them out. */
export function bookkeepingNoteIds(): Set<string> {
  const rows = getDb().prepare("SELECT note_id FROM memory_records WHERE role = 'overview' AND subject IN (?, ?)")
    .all(AGENT_NOW.subject, ACTIVITY.subject) as Array<{ note_id: string }>;
  return new Set(rows.map(row => row.note_id));
}
type ActivityInput = Extract<SessionMemoryInput, { action: "activity" }>;

// A line is: time UTC · runtime · [branch/head · ][files · ]counts[ · [[checkpoint]]]. `where` is everything between runtime and counts.
const ACTIVITY_LINE = /^- (.+?) UTC · (\S+) · ((?:.* · )?)(\d+) tool calls?, (\d+) prompts?( · \[\[[^\]]+\]\])?$/;

/** The line for this capture; `merged` is true when it replaces the newest line (same runtime, branch, commit, files and checkpoint) with the counts added. */
function activityLine(input: ActivityInput, linked: string | undefined, newest: string | undefined): { line: string; merged: boolean } {
  const { branch, head, files, files_changed, tool_calls, user_turns } = input.entry;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const changed = Math.max(files_changed, files.length);
  const where = [
    (branch || head) && [branch && `\`${branch}\``, head && `@ \`${head}\``].filter(Boolean).join(" "),
    changed && `${plural(changed, "file")} changed${files.length ? `: ${files.map(file => `\`${file}\``).join(", ")}${changed > files.length ? ` (+${changed - files.length} more)` : ""}` : ""}`,
  ].filter(Boolean).map(part => `${part} · `).join("");
  const tail = linked ? ` · [[${linked}]]` : "";
  const previous = newest && ACTIVITY_LINE.exec(newest);
  const merge = previous && previous[2] === input.runtime && previous[3] === where && (previous[6] ?? "") === tail;
  const calls = tool_calls + (merge ? Number(previous[4]) : 0);
  const prompts = user_turns + (merge ? Number(previous[5]) : 0);
  return { merged: Boolean(merge), line: `- ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${input.runtime} · ${where}${plural(calls, "tool call")}, ${plural(prompts, "prompt")}${tail}` };
}

/** The project's Activity note, renamed to its project title once when it still carries an older one. Rename and record change together. */
function currentActivityNote(area: string, project: string | undefined): Note | null {
  const db = getDb();
  const existing = db.prepare("SELECT note_id, folder, title, closed_at FROM memory_records WHERE folder = ? AND role = 'overview' AND subject = ? AND owner_id = 'shared'")
    .get(memoryFolder(area, project), ACTIVITY.subject) as SessionRecord | undefined;
  let note = existing ? inPlace(existing) : null;
  // Same rule as Agent Now: a trashed log is restored, one the owner moved or renamed is left and a fresh one starts.
  if (note?.deleted_at != null) note = restoreNote(note.id);
  else if (existing && !note) db.prepare("DELETE FROM memory_records WHERE note_id = ?").run(existing.note_id);
  const title = activityTitle(project);
  // updateNote rewrites links to the old title, resolving each by path first so other projects' "Activity" notes keep their links.
  // A note the owner already put at the new title blocks the rename; the log keeps its old title.
  if (existing && note && note.title !== title && !getNoteByPath(note.folder, title)) {
    note = updateNote(note.id, { title });
    db.prepare("UPDATE memory_records SET title = ? WHERE note_id = ?").run(title, existing.note_id);
  }
  return note;
}

/** Writes the Activity line and refreshes the linked checkpoint's Agent Now date; the checkpoint note itself is never edited. */
function recordActivity(principal: ApiKeyPrincipal, area: string, input: ActivityInput, record: SessionRecord | undefined): SessionMemoryReceipt {
  const note = currentActivityNote(area, input.project);
  const checkpoint = record ? inPlace(record) : null;
  const linked = record && checkpoint && checkpoint.deleted_at == null ? `${record.folder}/${record.title}` : undefined;
  const lines = (note?.content ?? "").split("\n");
  const earlier = lines.filter(line => line.startsWith("- "));
  const { line, merged } = activityLine(input, linked, earlier[0]);
  const entries = [line, ...earlier.slice(merged ? 1 : 0)].slice(0, ACTIVITY.lines);
  // Leave room for the newest capture even if the owner filled the note with header text.
  const head = (lines.filter(line => !line.startsWith("- ")).join("\n").trim() || "# Activity").slice(0, 64_000 - entries[0].length - 4);
  while (`${head}\n\n${entries.join("\n")}\n`.length > 64_000) entries.pop();
  const written = writeMemory(principal, {
    request_id: `session-activity-${hash([principal.id, input]).slice(0, 40)}`,
    project: input.project, role: "overview", subject: ACTIVITY.subject, session_id: input.session_id, title: note?.title ?? activityTitle(input.project),
    content: `${head}\n\n${entries.join("\n")}\n`, expected_revision: note ? memoryRevision(note) : null,
  });
  if (record && linked) updateNow(principal, area, memoryProject(area, record.folder), input, record.title);
  return { saved: true, request_id: input.request_id, note_id: written.note_id, revision: written.revision, closed: false, retained_note_id: null, joined: false, title: linked && record ? record.title : null };
}

/** A link (session or thread) to a checkpoint; a link to a note the owner moved or renamed is dropped. */
function linkedRecord(area: string, ownerId: string, subject: string): SessionRecord | undefined {
  const db = getDb();
  const linked = db.prepare(`SELECT r.note_id, r.folder, r.title, r.closed_at FROM memory_session_links l JOIN memory_records r ON r.note_id = l.note_id WHERE l.owner_id = ? AND l.subject = ? AND ${inArea.replaceAll("folder", "r.folder")}`)
    .get(ownerId, subject, ...areaArgs(area)) as SessionRecord | undefined;
  if (linked && !inPlace(linked)) {
    db.prepare("DELETE FROM memory_session_links WHERE owner_id = ? AND subject = ?").run(ownerId, subject);
    return undefined;
  }
  return linked;
}

function link(ownerId: string, subject: string, noteId: string): void {
  getDb().prepare("INSERT INTO memory_session_links (owner_id, subject, note_id, created_at) VALUES (?,?,?,?) ON CONFLICT (owner_id, subject) DO UPDATE SET note_id = excluded.note_id, created_at = excluded.created_at")
    .run(ownerId, subject, noteId, now());
}

/** Strips any trailing `(runtime-hex)` suffixes earlier releases minted, folds case and collapses whitespace. */
const workstream = (title: string) => title.replace(/(\s*\([a-z]+-[a-f0-9]+\))+\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The session record in this folder with the same workstream title: active before finished, then most recently updated. */
function matchWorkstream(folder: string, title: string): SessionRecord | undefined {
  const rows = getDb().prepare("SELECT r.note_id, r.folder, r.title, r.closed_at FROM memory_records r JOIN notes n ON n.id = r.note_id WHERE r.folder = ? AND r.role = 'session' AND n.folder = r.folder AND n.title = r.title AND n.deleted_at IS NULL ORDER BY r.closed_at IS NOT NULL, n.updated_at DESC")
    .all(folder) as SessionRecord[];
  const key = workstream(title);
  return rows.find(row => workstream(row.title) === key);
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
  link(ownerId, subject, target.note_id);
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
  if (!parsed.success) {
    // Name the failing fields so agents can correct the call; issue messages never echo input values.
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    throw new MemoryError(`Invalid session memory operation (${issues})`, 400, "invalid_input");
  }
  const input = parsed.data;
  const area = status.area;
  const db = getDb();
  return db.transaction(() => {
    // Session identity spans the whole area: a checkpoint stays in the project folder where it was created.
    // Resolution order: this session's link, the thread's link, this session's own record, then (save only) a workstream match.
    // An explicit continue only weighs this session's own checkpoint, so its active-work guard is unchanged.
    const ownerId = JSON.stringify([principal.id, input.session_id]);
    const subject = `session:${input.runtime}`;
    const threadOwner = input.thread_key ? JSON.stringify([principal.id, "thread", input.thread_key]) : null;
    const sessionLink = linkedRecord(area, ownerId, subject);
    const threadLink = !sessionLink && threadOwner && input.action !== "continue" ? linkedRecord(area, threadOwner, "thread") : undefined;
    const own = db.prepare(`SELECT note_id, folder, title, closed_at FROM memory_records WHERE ${inArea} AND role = 'session' AND subject = ? AND owner_id = ?`)
      .get(...areaArgs(area), subject, ownerId) as SessionRecord | undefined;
    let record = sessionLink ?? threadLink ?? own;
    let joined = Boolean(threadLink);
    const project = record ? memoryProject(area, record.folder) : input.project;
    if (input.action !== "read") {
      const previous = db.prepare("SELECT fingerprint, receipt_json FROM memory_session_requests WHERE actor_id = ? AND request_id = ?")
        .get(principal.id, input.request_id) as { fingerprint: string; receipt_json: string } | undefined;
      if (previous) {
        if (previous.fingerprint !== hash([area, input])) throw new MemoryError("Request identity reused with different content", 409, "request_conflict");
        return JSON.parse(previous.receipt_json) as SessionMemoryReceipt;
      }
    }
    const remember = (receipt: SessionMemoryReceipt) => {
      db.prepare("INSERT INTO memory_session_requests (actor_id, request_id, fingerprint, receipt_json, created_at) VALUES (?,?,?,?,?)")
        .run(principal.id, receipt.request_id, hash([area, input]), JSON.stringify(receipt), now());
      return receipt;
    };
    // Activity never resolves a workstream or links the session: it only records what happened.
    if (input.action === "activity") return remember(recordActivity(principal, area, input, record));
    const continuity = input.workstream || input.thread_key;
    const matched = input.action === "save" && continuity && !record ? matchWorkstream(memoryFolder(area, input.project), input.title) : undefined;
    if (matched) record = matched;
    joined ||= Boolean(matched);
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
      // A workstream match also names its title, since this session cannot read it through memory_session yet.
      throw new MemoryError(currentRevision === null
        ? "No session checkpoint exists yet; use expected_revision null to create it"
        : matched
          ? `Checkpoint [[${matched.title}]] already holds this workstream at revision ${currentRevision}; read that note, merge, and retry with that expected_revision to join it`
          : `Session memory is at revision ${currentRevision}; read it, merge, and retry with that expected_revision`, 409, "revision_conflict");
    }
    else if (input.action === "save") {
      if (record?.closed_at === null && note?.deleted_at != null) throw new MemoryError("Session checkpoint is in Trash; finish its cleanup or restore it before saving", 409, "ineligible_note");
      // Finished checkpoints are kept records; older clients would overwrite them without merging.
      if (record?.closed_at != null && note?.deleted_at == null && !input.reopen && !matched) {
        throw new MemoryError("This checkpoint is finished and kept as a record; read it, merge, and save with reopen", 409, "reopen_required");
      }
      if (record?.closed_at != null && note) restoreNote(note.id);
      // status reuses the vault property dictionary so checkpoints can be filtered with prop_key/prop_value.
      const content = applyFrontmatter(input.content, { status: "active" });
      const title = record?.title ?? (continuity ? input.title : `${input.title.slice(0, 87)} (${input.runtime}-${hash([principal.id, input.session_id]).slice(0, 12)})`);
      if (record !== own && note) {
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
    if (joined && noteId) link(ownerId, subject, noteId);
    if (threadOwner && noteId) link(threadOwner, "thread", noteId);
    const finalRecord = noteId ? db.prepare("SELECT note_id, folder, title, closed_at FROM memory_records WHERE note_id = ?").get(noteId) as SessionRecord : null;
    const finalNote = finalRecord ? registeredNote(finalRecord) : null;
    const receipt: SessionMemoryReceipt = {
      saved: true, request_id: input.request_id, note_id: noteId,
      revision: finalRecord && finalNote ? sessionRevision(finalRecord, finalNote) : null,
      closed: input.action === "finish", retained_note_id: retainedNoteId,
      joined, title: finalRecord?.title ?? null,
    };
    return remember(receipt);
  }).immediate();
}
