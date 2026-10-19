import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readMemory, writeMemory } from "../src/features/memory/memory";
import { MemoryError } from "../src/features/memory/types";
import { getDb } from "../src/lib/db";
import { createNote, deleteNote, getNote, updateNote } from "../src/lib/notes";
import type { ApiKeyPrincipal } from "../src/server/auth/api-key-authorization";

const vault = mkdtempSync(join(tmpdir(), "chibako-automatic-memory-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const actor: ApiKeyPrincipal = { id: "agent-a", scopes: ["memory:write", "notes:read"] };
const otherActor: ApiKeyPrincipal = { id: "agent-b", scopes: ["memory:write", "notes:read"] };
const input = (overrides: Record<string, unknown> = {}) => ({
  request_id: randomUUID(), role: "session", subject: "task-1", session_id: "run-1",
  title: "Session checkpoint", content: "Initial checkpoint [[Architecture]]", expected_revision: null,
  ...overrides,
});
function rejectsCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error) => error instanceof MemoryError && error.code === code);
}

test("creates isolated session notes and retries with the original receipt after later edits", () => {
  const initialInput = input();
  const first = writeMemory(actor, initialInput);
  const note = getNote(first.note_id)!;
  assert.equal(note.folder, "Agent Memory");
  assert.equal(note.content, "Initial checkpoint [[Architecture]]");
  assert.equal((getDb().prepare("SELECT id FROM notes_fts WHERE id = ?").get(note.id) as { id: string }).id, note.id);
  assert.equal((getDb().prepare("SELECT target_title FROM links WHERE source_id = ?").get(note.id) as { target_title: string }).target_title, "Architecture");
  assert.equal(readMemory(actor, { role: "session", subject: "task-1", session_id: "run-1" }).revision, first.revision);
  assert.deepEqual(readMemory(otherActor, { role: "session", subject: "task-1", session_id: "run-1" }), { note: null, revision: null });
  assert.deepEqual(readMemory(actor, { role: "session", subject: "task-1", session_id: "run-2" }), { note: null, revision: null });

  const update = writeMemory(actor, input({ request_id: randomUUID(), content: "Revised checkpoint", expected_revision: first.revision }));
  assert.notEqual(update.revision, first.revision);
  assert.deepEqual(writeMemory(actor, initialInput), first, "an idempotent retry returns the stored receipt");
  assert.equal(getNote(note.id)?.content, "Revised checkpoint");
  rejectsCode(() => writeMemory(actor, { ...initialInput, content: "Changed retry payload" }), "request_conflict");
});

test("shared wiki writes use revision conflicts and leave unrelated notes protected", () => {
  const args = input({ role: "wiki", subject: "typescript", title: "TypeScript", content: "First version" });
  const created = writeMemory(actor, args);
  assert.equal(readMemory(otherActor, { role: "wiki", subject: "typescript", session_id: "anything" }).revision, created.revision);
  const next = writeMemory(otherActor, input({ role: "wiki", subject: "typescript", title: "TypeScript", content: "Second version", expected_revision: created.revision }));
  rejectsCode(() => writeMemory(actor, input({ role: "wiki", subject: "typescript", title: "TypeScript", content: "Stale competing version", expected_revision: created.revision })), "revision_conflict");
  assert.equal(getNote(next.note_id)?.content, "Second version");

  const existing = createNote({ folder: "Agent Memory", title: "Preexisting", content: "Human-authored" });
  rejectsCode(() => writeMemory(actor, input({ role: "wiki", subject: "existing", title: existing.title, content: "overwrite", expected_revision: null })), "ineligible_note");
  const moved = writeMemory(actor, input({ role: "wiki", subject: "movable", title: "Movable", content: "Owned" }));
  updateNote(moved.note_id, { folder: "Elsewhere" });
  rejectsCode(() => readMemory(actor, { role: "wiki", subject: "movable", session_id: "run-1" }), "ineligible_note");
  const renamed = writeMemory(actor, input({ role: "wiki", subject: "renamed", title: "Renamed", content: "Owned" }));
  updateNote(renamed.note_id, { title: "Renamed externally" });
  rejectsCode(() => readMemory(actor, { role: "wiki", subject: "renamed", session_id: "run-1" }), "ineligible_note");
  const deleted = writeMemory(actor, input({ role: "wiki", subject: "deleted", title: "Deleted", content: "Owned" }));
  deleteNote(deleted.note_id);
  rejectsCode(() => readMemory(actor, { role: "wiki", subject: "deleted", session_id: "run-1" }), "ineligible_note");
});

test("requires explicit scopes and preference confirmation, validates inputs, and stays disabled without a configured folder", () => {
  rejectsCode(() => readMemory({ ...actor, scopes: ["*"] }, { role: "session", subject: "x", session_id: "y" }), "forbidden");
  rejectsCode(() => readMemory({ ...actor, scopes: ["memory:write"] }, { role: "session", subject: "x", session_id: "y" }), "forbidden");
  rejectsCode(() => writeMemory({ ...actor, scopes: ["notes:write"] }, input()), "forbidden");
  const before = (getDb().prepare("SELECT COUNT(*) AS count FROM notes").get() as { count: number }).count;
  rejectsCode(() => writeMemory(actor, input({ role: "preference", subject: "format", title: "Preference", content: "Use concise answers" })), "confirmation_required");
  rejectsCode(() => writeMemory(actor, input({ content: "" })), "invalid_input");
  const afterInvalid = (getDb().prepare("SELECT COUNT(*) AS count FROM notes").get() as { count: number }).count;
  assert.equal(afterInvalid, before, "rejected input does not create partial notes");
  writeMemory(actor, input({ role: "preference", subject: "format", title: "Preference", content: "Use concise answers", confirmation: { source: "user", scope: "this conversation" } }));
  const after = (getDb().prepare("SELECT COUNT(*) AS count FROM notes").get() as { count: number }).count;
  assert.equal(after, before + 1, "a confirmed preference is persisted");

  const configured = process.env.CHIBAKO_MEMORY_FOLDER;
  delete process.env.CHIBAKO_MEMORY_FOLDER;
  try { rejectsCode(() => writeMemory(actor, input()), "memory_disabled"); }
  finally { process.env.CHIBAKO_MEMORY_FOLDER = configured; }
});
