import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sessionMemory } from "../../src/features/memory/session-memory";
import { MemoryError } from "../../src/features/memory/types";
import { getDb } from "../../src/lib/db";
import { stripFrontmatter } from "../../src/lib/markdown";
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
  assert.equal(stripFrontmatter(note.content), "Changed objective");
  assert.equal(note.properties.status, "active");
  const now = listNotes().find(note => note.title === "Agent Now")!;
  assert.equal(getNote(now.id)!.content.split("\n").filter(line => line.startsWith("- [[")).length, 1);
  const other = sessionMemory({ ...actor, id: "other-agent" }, { ...identity, action: "read" });
  assert.deepEqual(other, { note: null, revision: null, closed: false });
  assert.deepEqual(read({ runtime: "codex" }), { note: null, revision: null, closed: false });
  assert.deepEqual(read({ session_id: "another-session" }), { note: null, revision: null, closed: false });
  rejected(() => receipt(save({ expected_revision: first.revision })), "revision_conflict");
  assert.throws(() => receipt(save({ session_id: "fresh-session", expected_revision: "0".repeat(64) })), /expected_revision null/);
  const omitRevision = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== "expected_revision"));
  assert.ok(receipt(omitRevision(save({ session_id: "omitted-revision-session" }))).note_id, "an omitted expected_revision creates a new checkpoint");
  rejected(() => receipt(omitRevision(save())), "revision_conflict");
});

test("completion preserves durable knowledge, removes only this session from Agent Now and keeps its record", () => {
  const current = read();
  const another = receipt(save({ session_id: "other-session", title: "Other active work" }));
  const finish = {
    ...identity, action: "finish", request_id: randomUUID(), expected_revision: current.revision,
    retain: { role: "wiki", subject: "fixture-decision", title: "Reusable decision", content: "Why the decision matters", expected_revision: null },
  };
  const result = receipt(finish);
  assert.equal(result.closed, true);
  assert.equal(getNote(result.note_id!)!.deleted_at, null, "finish keeps the checkpoint as a session record");
  assert.equal(getNote(result.retained_note_id!)!.content, "Why the decision matters");
  assert.equal(read().closed, true);
  assert.equal(read().note!.id, result.note_id);
  const now = getNote(listNotes().find(note => note.title === "Agent Now")!.id)!.content;
  assert.ok(!now.includes(`[[${current.note!.title}]]`));
  assert.ok(now.includes(`[[${getNote(another.note_id!)!.title}]]`));
  assert.deepEqual(receipt(finish), result, "lost-response retries return the original receipt");
  rejected(() => receipt({ ...finish, retain: { ...finish.retain, content: "Changed retry" } }), "request_conflict");
  rejected(() => receipt(save({ expected_revision: read().revision, content: "Old client without merge" })), "reopen_required");
  assert.equal(getNote(result.note_id!)!.properties.status, "done");
  assert.equal(stripFrontmatter(getNote(result.note_id!)!.content), "Changed objective", "the kept record is not overwritten without reopen");
  const resumed = receipt(save({ expected_revision: read().revision, content: "Follow-up in the same host session", reopen: true }));
  assert.equal(resumed.note_id, result.note_id, "resume restores its own checkpoint rather than duplicating it");
  assert.equal(resumed.closed, false);
  assert.equal(getNote(resumed.note_id!)!.properties.status, "active", "reopening marks the checkpoint active again");
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

test("a failed Agent Now write rolls back checkpoint creation", () => {
  const now = listNotes().find(note => note.title === "Agent Now")!;
  updateNote(now.id, { title: "Agent Now moved by owner" });
  const squatter = createNote({ folder: "Agent Memory", title: "Agent Now", content: "Owner's own note" });
  rejected(() => receipt(save({ session_id: "rollback-session" })), "ineligible_note");
  assert.equal(read({ session_id: "rollback-session" }).note, null, "the checkpoint is not created when its index write fails");
  assert.ok(getDb().prepare("SELECT 1 FROM memory_records WHERE note_id = ?").get(now.id), "the index record survives the rollback");
  getDb().prepare("DELETE FROM notes WHERE id = ?").run(squatter.id);
  updateNote(now.id, { title: "Agent Now" });
});

test("a trashed Agent Now is restored and a moved one is replaced, so saves never block on the index", () => {
  const db = getDb();
  const now = listNotes().find(note => note.title === "Agent Now")!;
  deleteNote(now.id);
  receipt(save({ session_id: "index-trashed", title: "After trash" }));
  assert.equal(getNote(now.id)!.deleted_at, null, "the managed index comes back");
  updateNote(now.id, { title: "Old Agent Now" });
  receipt(save({ session_id: "index-moved", title: "After move" }));
  const fresh = listNotes().find(note => note.title === "Agent Now" && note.folder === "Agent Memory")!;
  assert.notEqual(fresh.id, now.id);
  assert.ok(getNote(fresh.id)!.content.includes("After move"));
  assert.ok(getNote(now.id), "the owner's moved copy is left as a plain note");
  db.prepare("DELETE FROM memory_records WHERE note_id = ?").run(fresh.id);
  deleteNote(fresh.id);
  db.prepare("DELETE FROM notes WHERE id = ?").run(fresh.id);
  db.prepare("INSERT INTO memory_records (note_id, folder, title, role, subject, owner_id) VALUES (?,?,?,?,?,?)").run(now.id, "Agent Memory", "Agent Now", "overview", "Agent Now", "shared");
  updateNote(now.id, { title: "Agent Now" });
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
  const now = getNote(listNotes().find(note => note.title === "Agent Now")!.id)!.content;
  assert.ok(!now.includes(`[[${title}]]`));
});

test("project sessions file checkpoint and retained notes in their project folder; Agent Now stays at the root", () => {
  const session_id = "project-session";
  const created = receipt(save({ session_id, project: "atlas", title: "Atlas work" }));
  const note = getNote(created.note_id!)!;
  assert.equal(note.folder, "Agent Memory/atlas");
  assert.deepEqual(listNotes().filter(item => /Now$/.test(item.title)).map(item => item.folder), ["Agent Memory"], "one Agent Now, at the area root");
  const projectNow = listNotes().find(item => item.title === "Agent Now")!;
  assert.ok(getNote(projectNow.id)!.content.includes(`- [[${note.title}]] (atlas) — Continue work`));

  const moved = receipt(save({ session_id, project: "other", content: "Changed directory", expected_revision: read({ session_id }).revision }));
  assert.equal(moved.note_id, created.note_id, "a project change mid-session keeps the same checkpoint");
  assert.equal(getNote(moved.note_id!)!.folder, "Agent Memory/atlas");
  assert.ok(!listNotes().some(item => item.folder === "Agent Memory/other"));

  const finished = receipt({ ...identity, session_id, action: "finish", request_id: randomUUID(), expected_revision: read({ session_id }).revision,
    retain: { role: "wiki", subject: "atlas-lesson", title: "Atlas lesson", content: "Reusable", expected_revision: null } });
  assert.equal(getNote(finished.retained_note_id!)!.folder, "Agent Memory/atlas");
  assert.ok(!getNote(projectNow.id)!.content.includes(`[[${note.title}]]`));
  const crossProject = receipt({ ...identity, session_id: "project-session-2", project: "atlas", action: "finish", request_id: randomUUID(), expected_revision: null,
    retain: { role: "wiki", subject: "shared-lesson", title: "Shared lesson", content: "Applies everywhere", expected_revision: null, project: null } });
  assert.equal(getNote(crossProject.retained_note_id!)!.folder, "Agent Memory");
  for (const project of ["..", "a/b", "Upper", "-lead", ""]) rejected(() => receipt(save({ session_id: `bad-${project}`, project })), "invalid_input");
});

test("legacy per-project Now indexes fold into Agent Now and move to Trash", () => {
  const db = getDb();
  const legacy = [["Agent Memory", "- [[Root thread]] — root next"], ["Agent Memory/beta", "- [[Beta thread]] — beta next"]].map(([folder, content]) => {
    const note = createNote({ folder, title: "Now", content: `# Now\n\n${content}\n` });
    db.prepare("INSERT INTO memory_records (note_id, folder, title, role, subject, owner_id) VALUES (?,?,?,?,?,?)").run(note.id, folder, "Now", "overview", "Now", "shared");
    return note;
  });
  const renamed = createNote({ folder: "Agent Memory/gamma", title: "Now", content: "- [[Gamma thread]] — owner renamed this" });
  db.prepare("INSERT INTO memory_records (note_id, folder, title, role, subject, owner_id) VALUES (?,?,?,?,?,?)").run(renamed.id, "Agent Memory/gamma", "Now", "overview", "Now", "shared");
  updateNote(renamed.id, { title: "Gamma history" });
  receipt(save({ session_id: "migration-session", title: "Migration trigger" }));
  assert.equal(getNote(renamed.id)!.deleted_at, null, "a legacy Now the owner renamed or moved is left alone");
  const content = getNote(listNotes().find(note => note.title === "Agent Now")!.id)!.content;
  assert.ok(content.includes("- [[Root thread]] — root next"));
  assert.ok(content.includes("- [[Beta thread]] (beta) — beta next"));
  for (const note of legacy) assert.ok(getNote(note.id, true)!.deleted_at, "legacy Now is recoverable from Trash");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM memory_records WHERE subject = 'Now'").get() as { count: number }).count, 0);
});

test("another runtime and key can continue one shared checkpoint without duplicating it", () => {
  const created = receipt(save({ session_id: "handoff-claude", project: "atlas", title: "Shared handoff" }));
  const title = getNote(created.note_id!)!.title;
  const codex: ApiKeyPrincipal = { ...actor, id: "codex-agent" };
  const codexIdentity = { runtime: "codex", session_id: "handoff-codex" };
  const joined = sessionMemory(codex, { ...codexIdentity, action: "continue", request_id: randomUUID(), title });
  assert.ok("saved" in joined && joined.note_id === created.note_id);
  const current = sessionMemory(codex, { ...codexIdentity, action: "read" });
  assert.ok("note" in current && current.note!.id === created.note_id);
  const updated = sessionMemory(codex, { ...codexIdentity, action: "save", request_id: randomUUID(), title: "Ignored", content: "Codex progress", expected_revision: current.revision, now_line: "Codex next" });
  assert.ok("saved" in updated && updated.note_id === created.note_id);
  assert.equal(stripFrontmatter(getNote(created.note_id!)!.content), "Codex progress");
  assert.equal(listNotes().filter(note => note.title.startsWith("Shared handoff")).length, 1);
  const now = getNote(listNotes().find(note => note.title === "Agent Now")!.id)!.content;
  assert.ok(now.includes(`- [[${title}]] (atlas) — Codex next`));
  rejected(() => receipt(save({ session_id: "handoff-claude", content: "Stale", expected_revision: created.revision })), "revision_conflict");
  const claudeRead = read({ session_id: "handoff-claude" });
  assert.equal(stripFrontmatter(claudeRead.note!.content), "Codex progress", "the original session sees the continued work");
  rejected(() => sessionMemory(codex, { ...codexIdentity, session_id: "busy", action: "continue", request_id: randomUUID(), title: "No such checkpoint" }), "ineligible_note");
  receipt(save({ session_id: "busy-own", title: "Own work" }));
  rejected(() => receipt({ ...identity, session_id: "busy-own", action: "continue", request_id: randomUUID(), title }), "session_active");
  const shared = sessionMemory(codex, { ...codexIdentity, action: "read" });
  assert.ok("note" in shared);
  sessionMemory(codex, { ...codexIdentity, action: "finish", request_id: randomUUID(), expected_revision: shared.revision });
  assert.equal(read({ session_id: "handoff-claude" }).closed, true, "a continuing session's finish closes the shared checkpoint for all");
  assert.ok(!getNote(listNotes().find(note => note.title === "Agent Now")!.id)!.content.includes(`[[${title}]]`));
  const late = sessionMemory(codex, { ...codexIdentity, session_id: "late", action: "continue", request_id: randomUUID(), title });
  assert.ok("saved" in late && late.note_id === created.note_id, "a finished record can still be continued");
});

test("a legacy Now that does not fit or has owner text is kept as a plain note", () => {
  const db = getDb();
  const lines = Array.from({ length: 16 }, (_, index) => `- [[Overflow ${index}]] — x`).join("\n");
  const legacy = [["Agent Memory/delta", `# Now\n\n${lines}\n`], ["Agent Memory/epsilon", "Owner note: keep this\n- [[Eps thread]] — e\n"]].map(([folder, content]) => {
    const note = createNote({ folder, title: "Now", content });
    db.prepare("INSERT INTO memory_records (note_id, folder, title, role, subject, owner_id) VALUES (?,?,?,?,?,?)").run(note.id, folder, "Now", "overview", "Now", "shared");
    return note;
  });
  receipt(save({ session_id: "migration-keep", title: "Keep trigger" }));
  for (const note of legacy) assert.equal(getNote(note.id)!.deleted_at, null, "nothing is trashed unless Agent Now holds all of it");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM memory_records WHERE subject = 'Now'").get() as { count: number }).count, 0);
});

test("a continued checkpoint the owner moved drops the link instead of locking the session out", () => {
  const created = receipt(save({ session_id: "link-owner", title: "Link target" }));
  const title = getNote(created.note_id!)!.title;
  const other = { ...identity, session_id: "link-follower" };
  receipt({ ...other, action: "continue", request_id: randomUUID(), title });
  updateNote(created.note_id!, { title: "Renamed by owner" });
  assert.deepEqual(sessionMemory(actor, { ...other, action: "read" }), { note: null, revision: null, closed: false });
  const own = receipt(save({ ...other, title: "Fresh own work" }));
  assert.notEqual(own.note_id, created.note_id);
});
