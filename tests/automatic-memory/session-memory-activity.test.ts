import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { sessionMemory } from "../../src/features/memory/session-memory";
import { MemoryError } from "../../src/features/memory/types";
import { getDb } from "../../src/lib/db";
import { createNote, getNote, getOutlinks, listNotes, updateNote } from "../../src/lib/notes";
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
// Identical consecutive captures merge, so tests that need many lines give each its own head.
const headed = (i: number, base: Record<string, unknown> = entry) => ({ ...base, head: i.toString(16).padStart(7, "0") });
const note = (folder: string, title: string) => listNotes().find(item => item.folder === folder && item.title === title);
const lines = (folder = "Agent Memory/atlas", title = "Activity — atlas") => getNote(note(folder, title)!.id)!.content.split("\n").filter(line => line.startsWith("- "));
const nowContent = () => getNote(note("Agent Memory", "Agent Now")!.id)!.content;

test("activity writes one metadata line per capture into the project's Activity note, newest first", () => {
  const first = receipt(activity("act-1"));
  assert.equal(first.note_id, note("Agent Memory/atlas", "Activity — atlas")!.id);
  assert.match(lines()[0], /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · codex · `feat\/x` @ `abc1234` · 4 files changed: `src\/a\.ts`, `docs\/b\.md` \(\+2 more\) · 5 tool calls, 2 prompts$/);
  receipt(activity("act-2", { entry: { tool_calls: 3, user_turns: 1, files_changed: 0 } }));
  assert.match(lines()[0], /· codex · 3 tool calls, 1 prompt$/, "outside git only counts are written");
  assert.equal(lines().length, 2);
  for (let i = 0; i < 35; i++) receipt(activity(`cap-${i}`, { entry: headed(i) }));
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
  const saved = receipt({ ...identity, action: "save", workstream: true, request_id: randomUUID(), title: "Linked work", content: "Body", now_line: "Keep going" });
  const nowNote = note("Agent Memory", "Agent Now")!;
  updateNote(nowNote.id, { content: nowContent().replace(/(Linked work\]\] \(atlas\) — Keep going) · \d{4}-\d{2}-\d{2}/, "$1 · 2020-01-01") });
  const checkpointBefore = getNote(saved.note_id!)!;
  // Backdate the checkpoint so only the refreshed line date keeps it out of the staleness pruning.
  getDb().prepare("UPDATE notes SET updated_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 30 * 86_400, saved.note_id);
  receipt({ ...identity, action: "activity", request_id: randomUUID(), entry });
  assert.match(lines()[0], /· claude · .* · \[\[Agent Memory\/atlas\/Linked work\]\]$/);
  assert.ok(getOutlinks(note("Agent Memory/atlas", "Activity — atlas")!.id).some(link => link.target_id === saved.note_id));
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(nowContent().includes(`- [[Agent Memory/atlas/Linked work]] (atlas) — Keep going · ${today}`), "date refreshed, next action unchanged");
  const checkpointAfter = getNote(saved.note_id!)!;
  assert.equal(checkpointAfter.content, checkpointBefore.content);
  assert.equal(checkpointAfter.properties.status, "active", "never marked stale by its own refresh");

  // The agent's next save still uses the revision it already held.
  const read = sessionMemory(actor, { ...identity, action: "read" });
  assert.ok("revision" in read && read.revision === saved.revision, "activity does not change the checkpoint revision");
});

test("a thread-linked session links the thread's checkpoint; an unlinked session gets no link", () => {
  const thread_key = "ab".repeat(32);
  receipt({ runtime: "claude", session_id: "thread-owner", project: "atlas", thread_key, action: "save", workstream: true, request_id: randomUUID(), title: "Thread work", content: "Body", now_line: "Next" });
  receipt(activity("thread-other", { thread_key }));
  assert.match(lines()[0], /\[\[Agent Memory\/atlas\/Thread work\]\]$/);
  receipt(activity("nobody"));
  assert.doesNotMatch(lines()[0], /\[\[/);
  const read = sessionMemory(actor, { runtime: "codex", session_id: "thread-other", action: "read" });
  assert.ok("note" in read && read.note === null, "activity never links the session to a checkpoint");
});

test("maximal Activity entries remain below the memory write content limit", () => {
  const entry = { branch: "b".repeat(120), head: "f".repeat(40), files: Array.from({ length: 10 }, (_, i) => `${i}${"x".repeat(299)}`), files_changed: 1_000_000, tool_calls: 1_000_000, user_turns: 1_000_000 };
  for (let i = 0; i < 35; i++) {
    const result = receipt(activity(`max-${i}`, { project: "maximal", entry: headed(i, entry) }));
    assert.ok(getNote(result.note_id!)!.content.length <= 64_000);
  }
  assert.ok(lines("Agent Memory/maximal", "Activity — maximal").length < 30, "oldest entries are dropped to fit the character budget");
  assert.match(lines("Agent Memory/maximal", "Activity — maximal")[0], /1000000 tool calls/);
  const log = note("Agent Memory/maximal", "Activity — maximal")!;
  updateNote(log.id, { content: "H".repeat(64_000) });
  receipt(activity("max-with-header", { project: "maximal", entry: headed(99, entry) }));
  assert.ok(getNote(log.id)!.content.length <= 64_000);
  assert.equal(lines("Agent Memory/maximal", "Activity — maximal").length, 1, "the newest capture survives an oversized header");
});

test("each project's Activity note has its own title; the area root keeps plain Activity", () => {
  const root = receipt(activity("root-title", { project: undefined }));
  assert.equal(getNote(root.note_id!)!.title, "Activity");
  assert.equal(getNote(note("Agent Memory/atlas", "Activity — atlas")!.id)!.folder, "Agent Memory/atlas");
  assert.equal(note("Agent Memory/atlas", "Activity"), undefined);
});

test("a legacy Activity note is renamed once, with its history and record, and links to it follow", () => {
  const first = receipt(activity("legacy-a", { project: "alpha" })).note_id!;
  const second = receipt(activity("legacy-b", { project: "beta", entry: headed(1) })).note_id!;
  const db = getDb();
  for (const id of [first, second]) {
    db.prepare("UPDATE notes SET title = 'Activity' WHERE id = ?").run(id);
    db.prepare("UPDATE notes_fts SET title = 'Activity' WHERE id = ?").run(id);
    db.prepare("UPDATE memory_records SET title = 'Activity' WHERE note_id = ?").run(id);
  }
  const linker = updateNote(note("Agent Memory/atlas", "Activity — atlas")!.id, {
    content: "# Activity\n\n[[Activity]] [[Agent Memory/beta/Activity]] [[Agent Memory/alpha/Activity|alpha log]]\n",
  })!;
  const before = lines("Agent Memory/alpha", "Activity");
  receipt(activity("legacy-c", { project: "beta", entry: headed(2) }));
  const beta = getNote(second)!;
  assert.equal(beta.title, "Activity — beta");
  assert.equal(note("Agent Memory/beta", "Activity"), undefined, "no duplicate left behind");
  assert.equal(lines("Agent Memory/beta", "Activity — beta").length, 2, "history kept and the new capture added");
  assert.equal((db.prepare("SELECT title FROM memory_records WHERE note_id = ?").get(second) as { title: string }).title, "Activity — beta");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM memory_records WHERE note_id = ?").get(second) as { n: number }).n, 1);
  const content = getNote(linker.id)!.content;
  assert.ok(content.includes("[[Agent Memory/beta/Activity — beta]]"), "path link follows the rename");
  assert.ok(content.includes("[[Activity]]"), "a bare title that resolves to another project's note is not retargeted");
  assert.ok(content.includes("[[Agent Memory/alpha/Activity|alpha log]]"), "the other project's link is untouched");
  assert.equal(getNote(first)!.title, "Activity", "only the project that captured is renamed");
  assert.deepEqual(lines("Agent Memory/alpha", "Activity"), before);
  const resolved = getOutlinks(linker.id).map(link => link.target_id).sort();
  assert.deepEqual(resolved, [first, note("Agent Memory", "Activity")!.id, second].sort(), "each link still reaches the note it named");
  // A second capture changes nothing about the title.
  receipt(activity("legacy-d", { project: "beta", entry: headed(3) }));
  assert.equal(getNote(second)!.title, "Activity — beta");
});

test("a rename blocked by an existing note keeps the legacy title and still records the capture", () => {
  const id = receipt(activity("blocked-a", { project: "gamma" })).note_id!;
  const db = getDb();
  db.prepare("UPDATE notes SET title = 'Activity' WHERE id = ?").run(id);
  db.prepare("UPDATE notes_fts SET title = 'Activity' WHERE id = ?").run(id);
  db.prepare("UPDATE memory_records SET title = 'Activity' WHERE note_id = ?").run(id);
  createNote({ folder: "Agent Memory/gamma", title: "Activity — gamma", content: "mine" });
  const result = receipt(activity("blocked-b", { project: "gamma", entry: headed(7) }));
  assert.equal(result.note_id, id);
  assert.equal(getNote(id)!.title, "Activity");
  assert.equal(lines("Agent Memory/gamma", "Activity").length, 2);
});

test("a capture matching the newest entry's branch, commit and files updates it and adds the counts", () => {
  const same = { ...entry, head: "dddd111", tool_calls: 5, user_turns: 2 };
  receipt(activity("merge-1", { project: "delta", entry: same }));
  receipt(activity("merge-2", { project: "delta", entry: { ...same, tool_calls: 7, user_turns: 1 } }));
  assert.equal(lines("Agent Memory/delta", "Activity — delta").length, 1, "one merged entry");
  assert.match(lines("Agent Memory/delta", "Activity — delta")[0], /· 12 tool calls, 3 prompts$/);
  receipt(activity("merge-3", { project: "delta", entry: { ...same, tool_calls: 1, user_turns: 1 } }));
  assert.match(lines("Agent Memory/delta", "Activity — delta")[0], /· 13 tool calls, 4 prompts$/, "keeps merging into the same newest entry");
  for (const other of [{ ...same, head: "eeee222" }, { ...same, branch: "feat/y" }, { ...same, files: ["src/other.ts"] }]) {
    receipt(activity(`merge-${other.head}-${other.branch}-${other.files[0]}`, { project: "delta", entry: other }));
  }
  assert.equal(lines("Agent Memory/delta", "Activity — delta").length, 4, "any difference starts a new entry");
  receipt(activity("merge-runtime", { project: "delta", runtime: "claude", entry: { ...same, files: ["src/other.ts"], tool_calls: 1, user_turns: 1 } }));
  assert.equal(lines("Agent Memory/delta", "Activity — delta").length, 5, "another runtime is its own entry");
  assert.match(lines("Agent Memory/delta", "Activity — delta")[0], /· claude · .* · 1 tool call, 1 prompt$/);
  receipt(activity("merge-singular", { project: "delta", runtime: "claude", entry: { ...same, files: ["src/other.ts"], tool_calls: 1, user_turns: 1 } }));
  assert.match(lines("Agent Memory/delta", "Activity — delta")[0], /· 2 tool calls, 2 prompts$/, "singular counts parse and add");
});

test("merging only touches the newest entry and keeps a link to its checkpoint", () => {
  const identity = { runtime: "claude", session_id: "merge-linked", project: "epsilon" };
  receipt({ ...identity, action: "save", workstream: true, request_id: randomUUID(), title: "Merge work", content: "Body", now_line: "Go" });
  receipt({ ...identity, action: "activity", request_id: randomUUID(), entry: { tool_calls: 2, user_turns: 1, files_changed: 0 } });
  receipt({ ...identity, action: "activity", request_id: randomUUID(), entry: { tool_calls: 3, user_turns: 1, files_changed: 0 } });
  const all = lines("Agent Memory/epsilon", "Activity — epsilon");
  assert.equal(all.length, 1);
  assert.match(all[0], /· claude · 5 tool calls, 2 prompts · \[\[Agent Memory\/epsilon\/Merge work\]\]$/);
});
