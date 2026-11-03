import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sessionMemory } from "../../src/features/memory/session-memory";
import { getDb } from "../../src/lib/db";
import { getNote, getOutlinks, listNotes, updateNote } from "../../src/lib/notes";
import type { ApiKeyPrincipal } from "../../src/server/auth/api-key-authorization";

const vault = mkdtempSync(join(tmpdir(), "chibako-session-aging-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const actor: ApiKeyPrincipal = { id: "fixture-agent", scopes: ["memory:write", "notes:read"] };
const identity = (session_id: string) => ({ runtime: "claude", session_id });
function receipt(raw: unknown) {
  const value = sessionMemory(actor, raw);
  assert.ok("saved" in value);
  return value;
}
const revision = (session_id: string) => {
  const value = sessionMemory(actor, { ...identity(session_id), action: "read" });
  assert.ok("note" in value);
  return value.revision;
};
const save = (session_id: string, title: string, now_line: string, project?: string) =>
  receipt({ ...identity(session_id), action: "save", workstream: true, request_id: randomUUID(), title, content: now_line, expected_revision: revision(session_id), now_line, project });
const nowNote = () => listNotes().find(note => note.title === "Agent Now" && note.folder === "Agent Memory")!;
const nowContent = () => getNote(nowNote().id)!.content;
const today = () => new Date().toISOString().slice(0, 10);
// A save that happened `days` ago: the checkpoint's update time and its Agent Now line date both move back.
const backdate = (noteId: string, days: number) => {
  const seconds = Math.floor(Date.now() / 1000) - days * 86_400;
  getDb().prepare("UPDATE notes SET updated_at = ? WHERE id = ?").run(seconds, noteId);
  const note = getNote(noteId)!;
  const title = `${note.folder}/${note.title}`;
  const date = new Date(seconds * 1000).toISOString().slice(0, 10);
  getDb().prepare("UPDATE notes SET content = ? WHERE id = ?").run(nowContent().split("\n").map(line => line.startsWith(`- [[${title}]]`) ? line.replace(/· \d{4}-\d{2}-\d{2}$/, `· ${date}`) : line).join("\n"), nowNote().id);
};

test("Agent Now lines carry their date; stale checkpoints drop out, are marked stale and return on save", () => {
  const old = save("aging-old", "Aging old work", "Old next", "atlas");
  const fresh = save("aging-fresh", "Aging fresh work", "Fresh next", "atlas");
  const oldTitle = getNote(old.note_id!)!.title;
  assert.ok(nowContent().includes(`- [[Agent Memory/atlas/${getNote(fresh.note_id!)!.title}]] (atlas) — Fresh next · ${today()}`), "new lines end with the date");
  // An undated line whose checkpoint is unknown has nothing to age by and stays.
  updateNote(nowNote().id, { content: `${nowContent().trimEnd()}\n- [[Undated legacy]] — kept\n` });

  backdate(old.note_id!, 6);
  save("aging-fresh", "Aging fresh work", "Tick");
  assert.ok(nowContent().includes(`[[Agent Memory/atlas/${oldTitle}]]`), "inside the window the entry stays");

  backdate(old.note_id!, 8);
  save("aging-fresh", "Aging fresh work", "Tock");
  assert.ok(!nowContent().includes(`[[Agent Memory/atlas/${oldTitle}]]`), "past the window the entry is dropped");
  assert.ok(nowContent().includes("- [[Undated legacy]] — kept"));
  const stale = getNote(old.note_id!)!;
  assert.equal(stale.properties.status, "stale");
  assert.equal(stale.deleted_at, null, "never deleted");
  const read = sessionMemory(actor, { ...identity("aging-old"), action: "read" });
  assert.ok("closed" in read && read.closed === false, "never closed");

  const back = save("aging-old", "Aging old work", "Back");
  assert.equal(getNote(back.note_id!)!.properties.status, "active");
  assert.ok(nowContent().includes(`- [[Agent Memory/atlas/${oldTitle}]] (atlas) — Back · ${today()}`));
});

test("CHIBAKO_MEMORY_STALE_DAYS sets the window", () => {
  const a = save("window-a", "Window a", "A next");
  save("window-b", "Window b", "B next");
  backdate(a.note_id!, 3);
  process.env.CHIBAKO_MEMORY_STALE_DAYS = "2";
  try { save("window-b", "Window b", "B again"); } finally { delete process.env.CHIBAKO_MEMORY_STALE_DAYS; }
  assert.ok(!nowContent().includes(`[[Agent Memory/${getNote(a.note_id!)!.title}]]`));
  assert.equal(getNote(a.note_id!)!.properties.status, "stale");
});

test("Agent Now isolates equal titles by project during save, refresh, aging and finish", () => {
  const a = save("same-a", "Shared title", "A next", "project-a");
  const b = save("same-b", "Shared title", "B next", "project-b");
  assert.match(nowContent(), /\(project-a\) — A next/);
  assert.match(nowContent(), /\(project-b\) — B next/);
  assert.ok(getOutlinks(nowNote().id).some(link => link.target_id === a.note_id));
  assert.ok(getOutlinks(nowNote().id).some(link => link.target_id === b.note_id));
  // Exercise older plain links without dates as well as the new qualified links.
  updateNote(nowNote().id, { content: "- [[Shared title]] (project-a) — A next\n- [[Shared title]] (project-b) — B next · 2020-01-01\n" });
  getDb().prepare("UPDATE notes SET updated_at = ? WHERE id IN (?, ?)").run(Math.floor(Date.now() / 1000) - 30 * 86_400, a.note_id, b.note_id);
  receipt({ ...identity("same-a"), action: "activity", request_id: randomUUID(), entry: { tool_calls: 3, user_turns: 0 } });
  assert.match(nowContent(), /\(project-a\) — A next/);
  assert.doesNotMatch(nowContent(), /\(project-b\)/);
  assert.equal(getNote(a.note_id!)!.properties.status, "active");
  assert.equal(getNote(b.note_id!)!.properties.status, "stale");
  save("same-b", "Shared title", "B returned");
  receipt({ ...identity("same-a"), action: "finish", request_id: randomUUID(), expected_revision: revision("same-a") });
  assert.doesNotMatch(nowContent(), /\(project-a\)/);
  assert.match(nowContent(), /\(project-b\) — B returned/);
});

test("aging never edits a checkpoint moved or renamed by its owner", () => {
  for (const [session, change] of [["moved", { folder: "Private" }], ["renamed", { title: "Owner renamed" }]] as const) {
    const saved = save(session, `Aging ${session}`, "Next", "aging-boundary");
    backdate(saved.note_id!, 30);
    updateNote(saved.note_id!, change);
    getDb().prepare("UPDATE notes SET updated_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 30 * 86_400, saved.note_id);
    const before = getNote(saved.note_id!)!;
    save("aging-trigger", "Aging trigger", session);
    assert.deepEqual(getNote(saved.note_id!)!, before, "outside the registered location stays untouched");
  }
});
