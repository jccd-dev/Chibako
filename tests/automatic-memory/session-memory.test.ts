import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sessionMemory } from "../../src/features/memory/session-memory";
import { MemoryError } from "../../src/features/memory/types";
import { getDb } from "../../src/lib/db";
import { createNote, deleteNote, getNote, listNotes, updateNote } from "../../src/lib/notes";
import type { ApiKeyPrincipal } from "../../src/server/auth/api-key-authorization";

const vault = mkdtempSync(join(tmpdir(), "chibako-session-lifecycle-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const actor: ApiKeyPrincipal = { id: "fixture-agent", scopes: ["memory:write", "notes:read"] };
const identity = { runtime: "claude", session_id: "fixture-session" };
const save = (overrides: Record<string, unknown> = {}) => ({
  ...identity, action: "save", request_id: randomUUID(), title: "First task", content: "Confirmed decision [[Related]]", expected_revision: null, now_line: "Continue work", ...overrides,
});
function receipt(raw: unknown) {
  const value = sessionMemory(actor, raw);
  assert.ok("saved" in value);
  return value;
}
function read(overrides: Record<string, unknown> = {}) {
  const value = sessionMemory(actor, { ...identity, action: "read", ...overrides });
  assert.ok("note" in value);
  return value;
}
const rejected = (fn: () => unknown, code: string) => assert.throws(fn, error => error instanceof MemoryError && error.code === code);

test("task changes and resumed sessions update one stable note; runtimes and actors stay isolated", () => {
  const first = receipt(save());
  const second = receipt(save({ title: "Another task entirely", content: "Changed objective", expected_revision: first.revision }));
  assert.equal(first.note_id, second.note_id);
  const note = read().note!;
  assert.match(note.title, /^First task \(claude-/);
  assert.equal(note.content, "Changed objective");
  const now = listNotes().find(note => note.title === "Now")!;
  assert.equal(getNote(now.id)!.content.split("\n").filter(line => line.startsWith("- [[")).length, 1);
  const other = sessionMemory({ ...actor, id: "other-agent" }, { ...identity, action: "read" });
  assert.deepEqual(other, { note: null, revision: null, closed: false });
  assert.deepEqual(read({ runtime: "codex" }), { note: null, revision: null, closed: false });
  assert.deepEqual(read({ session_id: "another-session" }), { note: null, revision: null, closed: false });
  rejected(() => receipt(save({ expected_revision: first.revision })), "revision_conflict");
});

test("completion preserves durable knowledge and removes only this session from Now and active search", () => {
  const current = read();
  const another = receipt(save({ session_id: "other-session", title: "Other active work" }));
  const finish = {
    ...identity, action: "finish", request_id: randomUUID(), expected_revision: current.revision,
    retain: { role: "wiki", subject: "fixture-decision", title: "Reusable decision", content: "Why the decision matters", expected_revision: null },
  };
  const result = receipt(finish);
  assert.equal(result.closed, true);
  assert.equal(getNote(result.note_id!), null);
  assert.ok(getNote(result.note_id!, true)?.deleted_at);
  assert.equal(getNote(result.retained_note_id!)!.content, "Why the decision matters");
  assert.equal(read().closed, true);
  assert.equal(read().note, null);
  const now = getNote(listNotes().find(note => note.title === "Now")!.id)!.content;
  assert.ok(!now.includes(`[[${current.note!.title}]]`));
  assert.ok(now.includes(`[[${getNote(another.note_id!)!.title}]]`));
  assert.deepEqual(receipt(finish), result, "lost-response retries return the original receipt");
  rejected(() => receipt({ ...finish, retain: { ...finish.retain, content: "Changed retry" } }), "request_conflict");
  const resumed = receipt(save({ expected_revision: read().revision, content: "Follow-up in the same host session" }));
  assert.equal(resumed.note_id, result.note_id, "resume restores its own checkpoint rather than duplicating it");
  assert.equal(resumed.closed, false);
  assert.deepEqual(receipt(finish), result, "an old finish replay must not close newly resumed work");
  assert.ok(getNote(resumed.note_id!));
});

test("retention conflicts and denied/malformed operations cause no partial cleanup", () => {
  const current = read();
  const before = getNote(current.note!.id)!;
  const existing = createNote({ folder: "Agent Memory", title: "Human source", content: "Leave intact" });
  rejected(() => receipt({ ...identity, action: "finish", request_id: randomUUID(), expected_revision: current.revision,
    retain: { role: "wiki", subject: "human-source", title: existing.title, content: "Overwrite source", expected_revision: null },
  }), "ineligible_note");
  assert.equal(getNote(before.id)?.content, before.content);
  rejected(() => sessionMemory({ ...actor, scopes: ["notes:write", "notes:read"] }, save()), "forbidden");
  rejected(() => sessionMemory({ ...actor, scopes: ["memory:write"] }, save()), "forbidden");
  rejected(() => receipt({ ...identity, action: "finish", request_id: randomUUID(), expected_revision: current.revision,
    retain: { role: "preference", subject: "preference", title: "Preference fixture", content: "Unconfirmed", expected_revision: null },
  }), "confirmation_required");
  rejected(() => receipt({ ...identity, action: "finish", request_id: randomUUID(), expected_revision: current.revision, note_id: existing.id }), "invalid_input");
  assert.ok(getNote(before.id));
  assert.equal(getNote(existing.id)!.content, "Leave intact");
});

test("a failed Now update rolls back checkpoint creation and retention/cleanup together", () => {
  const now = listNotes().find(note => note.title === "Now")!;
  updateNote(now.id, { title: "Now moved by owner" });
  rejected(() => receipt(save({ session_id: "rollback-session" })), "ineligible_note");
  assert.equal(read({ session_id: "rollback-session" }).note, null);
  const current = read();
  rejected(() => receipt({ ...identity, action: "finish", request_id: randomUUID(), expected_revision: current.revision,
    retain: { role: "wiki", subject: "rollback-knowledge", title: "Must roll back", content: "Not committed", expected_revision: null },
  }), "ineligible_note");
  assert.ok(getNote(current.note!.id));
  assert.ok(!listNotes().some(note => note.title === "Must roll back"));
  updateNote(now.id, { title: "Now" });
});

test("finishing a trivial session creates no temporary note and still supports idempotent retention", () => {
  const before = listNotes().length;
  const finish = { ...identity, session_id: "trivial-session", action: "finish", request_id: randomUUID(), expected_revision: null };
  const result = receipt(finish);
  assert.equal(result.note_id, null);
  assert.equal(listNotes().length, before);
  assert.deepEqual(receipt(finish), result);
  const retained = receipt({ ...finish, request_id: randomUUID(), retain: { role: "wiki", subject: "quick-lesson", title: "Quick lesson", content: "Useful without a session log", expected_revision: null } });
  assert.equal(retained.note_id, null);
  assert.ok(retained.retained_note_id);
});

test("manually trashed checkpoints can finish their Now cleanup without reviving user-deleted content", () => {
  const session_id = "manually-trashed-session";
  const created = receipt(save({ session_id, title: "Manual trash fixture" }));
  const title = getNote(created.note_id!)!.title;
  deleteNote(created.note_id!);
  const current = read({ session_id });
  assert.equal(current.note, null);
  assert.equal(current.closed, true);
  rejected(() => receipt(save({ session_id, expected_revision: current.revision })), "ineligible_note");
  const finished = receipt({ ...identity, session_id, action: "finish", request_id: randomUUID(), expected_revision: current.revision });
  assert.equal(finished.closed, true);
  assert.equal(getNote(created.note_id!), null);
  const now = getNote(listNotes().find(note => note.title === "Now")!.id)!.content;
  assert.ok(!now.includes(`[[${title}]]`));
});
