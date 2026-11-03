import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sessionMemory } from "../../src/features/memory/session-memory";
import { MemoryError } from "../../src/features/memory/types";
import { getDb } from "../../src/lib/db";
import { getNote, listNotes, updateNote } from "../../src/lib/notes";
import type { ApiKeyPrincipal } from "../../src/server/auth/api-key-authorization";

const vault = mkdtempSync(join(tmpdir(), "chibako-session-activity-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const actor: ApiKeyPrincipal = { id: "fixture-agent", scopes: ["memory:write", "notes:read"] };
const entry = { branch: "feat/x", head: "abc1234", files: ["src/a.ts", "docs/b.md"], files_changed: 4, tool_calls: 5, user_turns: 2 };
const activity = (session_id: string, overrides: Record<string, unknown> = {}) =>
  ({ runtime: "codex", session_id, project: "atlas", action: "activity", request_id: randomUUID(), entry, ...overrides });
function receipt(raw: unknown) {
  const value = sessionMemory(actor, raw);
  assert.ok("saved" in value);
  return value;
}
const note = (folder: string, title: string) => listNotes().find(item => item.folder === folder && item.title === title);
const lines = (folder = "Agent Memory/atlas") => getNote(note(folder, "Activity")!.id)!.content.split("\n").filter(line => line.startsWith("- "));
const nowContent = () => getNote(note("Agent Memory", "Agent Now")!.id)!.content;

test("activity writes one metadata line per capture into the project's Activity note, newest first", () => {
  const first = receipt(activity("act-1"));
  assert.equal(first.note_id, note("Agent Memory/atlas", "Activity")!.id);
  assert.match(lines()[0], /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · codex · `feat\/x` @ `abc1234` · 4 files changed: `src\/a\.ts`, `docs\/b\.md` \(\+2 more\) · 5 tool calls, 2 prompts$/);
  receipt(activity("act-2", { entry: { tool_calls: 3, user_turns: 1, files_changed: 0 } }));
  assert.match(lines()[0], /· codex · 3 tool calls, 1 prompt$/, "outside git only counts are written");
  assert.equal(lines().length, 2);
  for (let i = 0; i < 35; i++) receipt(activity(`cap-${i}`));
  assert.equal(lines().length, 30, "capped at 30 lines");
  assert.equal(getNote(first.note_id!)!.kind, "index", "a managed overview note");
});

test("activity replays by request_id and rejects malformed entries without writing", () => {
  const request = activity("replay");
  const before = lines().length;
  const once = receipt(request);
  assert.deepEqual(receipt(request), once);
  assert.equal(getNote(once.note_id!)!.content.split("\n").filter(line => line.startsWith("- ")).length, Math.min(before + 1, 30));
  const content = getNote(once.note_id!)!.content;
  for (const bad of [
    { ...entry, head: "xyz" }, { ...entry, head: "abc12" }, { ...entry, files: Array(11).fill("a.ts") },
    { ...entry, files: ["/etc/passwd"] }, { ...entry, files: ["../up.ts"] }, { ...entry, files: ["a`b.ts"] }, { ...entry, files: ["a\nb"] },
    { ...entry, branch: "bad`branch" }, { ...entry, tool_calls: -1 }, { ...entry, prompt: "secret" },
  ]) {
    assert.throws(() => sessionMemory(actor, activity("bad", { entry: bad })), (error) => error instanceof MemoryError && error.code === "invalid_input");
  }
  assert.throws(() => sessionMemory(actor, { ...request, entry: { ...entry, tool_calls: 99 } }), (error) => error instanceof MemoryError && error.code === "request_conflict");
  assert.equal(getNote(once.note_id!)!.content, content, "rejections wrote nothing");
});

test("a linked session wikilinks its checkpoint and refreshes its Agent Now date without editing the checkpoint", () => {
  const identity = { runtime: "claude", session_id: "linked", project: "atlas" };
  const saved = receipt({ ...identity, action: "save", request_id: randomUUID(), title: "Linked work", content: "Body", now_line: "Keep going" });
  const nowNote = note("Agent Memory", "Agent Now")!;
  updateNote(nowNote.id, { content: nowContent().replace(/(Linked work\]\] \(atlas\) — Keep going) · \d{4}-\d{2}-\d{2}/, "$1 · 2020-01-01") });
  const checkpointBefore = getNote(saved.note_id!)!;
  // Backdate the checkpoint so only the refreshed line date keeps it out of the staleness pruning.
  getDb().prepare("UPDATE notes SET updated_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 30 * 86_400, saved.note_id);
  receipt({ ...identity, action: "activity", request_id: randomUUID(), entry });
  assert.match(lines()[0], /· claude · .* · \[\[Linked work\]\]$/);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(nowContent().includes(`- [[Linked work]] (atlas) — Keep going · ${today}`), "date refreshed, next action unchanged");
  const checkpointAfter = getNote(saved.note_id!)!;
  assert.equal(checkpointAfter.content, checkpointBefore.content);
  assert.equal(checkpointAfter.properties.status, "active", "never marked stale by its own refresh");

  // The agent's next save still uses the revision it already held.
  const read = sessionMemory(actor, { ...identity, action: "read" });
  assert.ok("revision" in read && read.revision === saved.revision, "activity does not change the checkpoint revision");
});

test("a thread-linked session links the thread's checkpoint; an unlinked session gets no link", () => {
  const thread_key = "ab".repeat(32);
  receipt({ runtime: "claude", session_id: "thread-owner", project: "atlas", thread_key, action: "save", request_id: randomUUID(), title: "Thread work", content: "Body", now_line: "Next" });
  receipt(activity("thread-other", { thread_key }));
  assert.match(lines()[0], /\[\[Thread work\]\]$/);
  receipt(activity("nobody"));
  assert.doesNotMatch(lines()[0], /\[\[/);
  const read = sessionMemory(actor, { runtime: "codex", session_id: "thread-other", action: "read" });
  assert.ok("note" in read && read.note === null, "activity never links the session to a checkpoint");
});
