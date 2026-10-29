import assert from "node:assert/strict";
import { prepareSessionStage } from "../../scripts/memory/session-stage";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectMemoryState, runMemoryEvent, type HookInput, type MemoryCall } from "../../scripts/memory/runtime";
import { MemoryClientError } from "../../scripts/memory/client-error";
import { conflictMessage } from "../../scripts/memory/connection";
import { createHash } from "node:crypto";
import { withPrivateLock } from "../../scripts/memory/private-files";

async function withPrivateDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chibako-memory-runtime-"));
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function checkpoint(session_id = "session-1") {
  return {
    request_id: randomUUID(), role: "session", subject: "task", session_id,
    title: "Checkpoint", content: "Work is in progress", expected_revision: null,
  };
}
function bound(checkpoint: { request_id: string; session_id: string; title: string; content: string; expected_revision: string | null }, runtime = "codex", now_line = "Work in progress") {
  return { action: "save", runtime, session_id: checkpoint.session_id, request_id: checkpoint.request_id,
    title: checkpoint.title, content: checkpoint.content, expected_revision: checkpoint.expected_revision, now_line };
}
const isSave = (name: string, args: Record<string, unknown>) => name === "memory_session" && args.action !== "read";
function event(hook_event_name: string, overrides: Partial<HookInput> = {}): HookInput {
  return { session_id: "session-1", hook_event_name, ...overrides };
}
function caller(calls: Array<{ name: string; args: Record<string, unknown> }>, response: MemoryCall = async () => ({})): MemoryCall {
  return async (name, args) => { calls.push({ name, args }); return response(name, args); };
}
async function readState(directory: string): Promise<Record<string, unknown>> {
  const files = await (await import("node:fs/promises")).readdir(directory);
  const stateFile = files.find((file) => file.endsWith(".json"));
  assert.ok(stateFile, "expected private runtime state file");
  return JSON.parse(await readFile(join(directory, stateFile), "utf8"));
}

async function tools(directory: string, call: MemoryCall, count = 10, runtime: "codex" | "claude" | "hermes" = "codex") {
  for (let i = 0; i < count; i++) await runMemoryEvent({ runtime, directory, enabled: true, call, input: event("PostToolUse") });
}

test("loads the Now index and first prompt recall once, from private state", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  const start = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("SessionStart", { prompt: "Resume the memory work" }) });
  assert.equal(calls.filter(({ name }) => name === "get_knowledge_schema").length, 0, "schema is fetched only when a checkpoint is due");
  assert.deepEqual(calls[0], { name: "memory_read", args: { role: "overview", subject: "Agent Now", session_id: "session-1" } });
  assert.equal(calls.filter(({ name }) => name === "recall").length, 1);
  assert.match(String(start.context), /Automatic memory:/);
  assert.equal((await stat(directory)).mode & 0o077, 0);

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-2", prompt: "Another prompt" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-3", prompt: "Again" }) });
  assert.deepEqual(calls.map(({ name }) => name), ["memory_read", "recall"]);
}));

test("Now is injected capped, and the instruction block appears once per session", async () => withPrivateDirectory(async (directory) => {
  const call = caller([], async (name) => name === "memory_read" ? { note: { content: "# Agent Now\n" + "- [[Thread]] — x\n".repeat(400) }, revision: "a".repeat(64) } : {});
  const start = await runMemoryEvent({ runtime: "codex", directory: join(directory, "second"), enabled: true, call, input: event("SessionStart") });
  const context = String(start.context);
  assert.ok(context.length < 2400, "Agent Now plus instruction stays within a few hundred tokens");
  const next = await runMemoryEvent({ runtime: "codex", directory: join(directory, "second"), enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t2" }) });
  assert.equal(next.context, undefined, "no per-prompt instruction or Now re-injection");
}));

test("a trivial session makes no extra calls, receives no block, and PostToolUse is silent", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("SessionStart") });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1", prompt: "quick question" }) });
  const before = calls.length;
  await tools(directory, call, 3, "claude");
  assert.deepEqual(await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Stop") }), {});
  assert.equal(calls.length, before, "counting and Stop add no memory calls");
  assert.equal(calls.some(({ name }) => name === "memory_write" || name === "get_knowledge_schema"), false);
}));

test("over the threshold, exactly one Stop request; a verified save resets the counters", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => isSave(name, args)
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64), closed: false } : {});
  for (let turn = 1; turn <= 4; turn++) await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: `t${turn}` }) });
  const requested = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") });
  assert.match(String(requested.request), /Memory checkpoint due/);
  assert.doesNotMatch(String(requested.reason), /Schema \(evidence/, "a checkpoint request carries no vault schema");
  assert.equal(calls.some(({ name }) => name === "get_knowledge_schema"), false);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).request, undefined);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t5" }) });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).request, undefined, "still one request until a save");

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: checkpoint() } });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") });
  const state = await readState(directory);
  assert.deepEqual([state.users, state.tools, state.dueRequested], [0, 0, false]);
  await tools(directory, call, 10);
  assert.match(String((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).request), /Memory checkpoint due/, "ten tool calls make a new checkpoint due");
}));

test("state files from before the activity gate still load and flush their pending checkpoint", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => name === "memory_write"
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64) } : {});
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-old" }) });
  const name = (await readdir(directory)).find((file) => file.endsWith(".json"))!;
  const legacy = { turn: "turn-old", requested: "", acknowledged: "", briefed: true, schemaLoaded: true, pending: { turn: "turn-old", checkpoint: checkpoint() } };
  await writeFile(join(directory, name), JSON.stringify(legacy));
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") });
  assert.deepEqual(calls.filter(({ name }) => name === "memory_write").map(({ args }) => args), [legacy.pending.checkpoint]);
  assert.equal((await readState(directory)).pending, undefined);
}));

// In-memory Now store with the server's revision rule; `conflicts` forces that many stale-revision failures.
function nowServer(conflicts = 0) {
  const store = { content: null as string | null, revision: null as string | null, version: 0, writes: 0, conflicts };
  const rotate = () => { store.version++; store.revision = String(store.version).padStart(64, "0"); };
  const call: MemoryCall = async (name, args) => {
    if (name === "memory_read") return store.content === null ? { note: null, revision: null } : { note: { content: store.content }, revision: store.revision };
    if (name !== "memory_write") return {};
    if (args.subject === "Agent Now") {
      if (store.conflicts > 0) { store.conflicts--; store.content = (store.content ?? "# Now") + "\n- [[Other]] — concurrent"; rotate(); throw new Error("revision_conflict"); }
      if (args.expected_revision !== store.revision) throw new MemoryClientError("Session memory conflict: stale revision.", { category: "conflict", phase: "call" });
      store.content = String(args.content); store.writes++; rotate();
      return { saved: true, request_id: args.request_id, note_id: "now", revision: store.revision };
    }
    return { saved: true, request_id: args.request_id, note_id: `thread-${args.subject}`, revision: "a".repeat(64) };
  };
  return { store, call };
}
const thread = (title: string, session_id = "session-1") => ({
  request_id: randomUUID(), role: "overview", subject: title, session_id, title, content: `# ${title}\nNext: continue`, expected_revision: null,
});
async function save(directory: string, call: MemoryCall, title: string, now_line: string, session_id = "session-1", runtime: "codex" | "claude" = "codex") {
  await runMemoryEvent({ runtime, directory, enabled: true, call, input: event("UserPromptSubmit", { session_id, turn_id: `turn-${title}` }) });
  const file = (await readdir(directory)).find(file => file.endsWith(".json"))!;
  const state = JSON.parse(await readFile(join(directory, file), "utf8"));
  state.pending = { turn: `turn-${title}`, checkpoint: thread(title, session_id), now_line };
  await writeFile(join(directory, file), JSON.stringify(state));
  await runMemoryEvent({ runtime, directory, enabled: true, call, input: event("Checkpoint", { session_id }) });
}

test("legacy pending saves from two runtimes recover their capped Now index", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = nowServer();
  await save(join(directory, "codex"), call, "Alpha", "ship the gate");
  await save(join(directory, "claude"), call, "Beta", "review", "session-2", "claude");
  await save(join(directory, "codex"), call, "Alpha", "done");
  const lines = store.content!.split("\n").filter((line) => line.startsWith("- [["));
  assert.deepEqual(lines, ["- [[Alpha]] — done", "- [[Beta]] — review"]);
  assert.match(store.content!, /^# Agent Now\n/);
  for (let i = 0; i < 20; i++) await save(join(directory, "codex"), call, `Thread ${i}`, "x");
  assert.equal(store.content!.split("\n").filter((line) => line.startsWith("- [[")).length, 15);
}));

test("the Agent Now briefing lists the current project's entries first", async () => withPrivateDirectory(async (directory) => {
  const content = "# Agent Now\n\n- [[Other]] (beta) — b\n- [[Root]] — r\n- [[Mine]] (atlas) — a\n";
  const call = caller([], async (name) => name === "memory_read" ? { note: { content }, revision: "a".repeat(64) } : {});
  const start = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, resolveProject: () => "atlas", input: event("SessionStart", { cwd: "/work/atlas" }) });
  const context = String(start.context);
  assert.ok(context.indexOf("[[Mine]]") < context.indexOf("[[Other]]") && context.indexOf("[[Mine]]") < context.indexOf("[[Root]]"));
}));

test("a stale Now revision is re-read and merged, never blindly replaced", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = nowServer(2);
  await save(directory, call, "Alpha", "ship");
  assert.match(store.content!, /- \[\[Other\]\] — concurrent/, "the concurrent writer's line survives");
  assert.match(store.content!, /- \[\[Alpha\]\] — ship/);
  const state = await readState(directory);
  assert.equal(state.nowUpdate, undefined);

  const failing = nowServer(5);
  const second = join(directory, "failing");
  await save(second, failing.call, "Alpha", "ship");
  assert.equal(failing.store.writes, 0, "exhausted retries write nothing");
  assert.ok((await readState(second)).nowUpdate, "the line stays pending for the next event");
  failing.store.conflicts = 0;
  await runMemoryEvent({ runtime: "codex", directory: second, enabled: true, call: failing.call, input: event("Checkpoint") });
  assert.match(failing.store.content!, /- \[\[Alpha\]\] — ship/);
}));

test("replaying a staged checkpoint creates no duplicate Now line", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = nowServer();
  const saved = thread("Alpha");
  for (let i = 0; i < 2; i++) {
    await save(directory, call, saved.title, "ship");
  }
  assert.equal(store.content!.match(/\[\[Alpha\]\]/g)?.length, 1);
  assert.equal(store.writes, 1, "the unchanged line is not rewritten");
}));

test("now_line requires a checkpoint and a plain single line", async () => withPrivateDirectory(async (directory) => {
  const call = caller([]);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t" }) });
  for (const stage of [
    { finish: {}, now_line: "ok" },
    { checkpoint: thread("Alpha"), now_line: "two\nlines" },
    { checkpoint: thread("Alpha"), now_line: "[[link]]" },
    { checkpoint: thread("A]]B"), now_line: "ok" },
  ]) await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage }));
}));

test("Hermes injects the checkpoint-due note once instead of blocking at prompt time", async () => withPrivateDirectory(async (directory) => {
  const call = caller([]);
  await runMemoryEvent({ runtime: "hermes", promptRequests: true, directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t0" }) });
  await tools(directory, call, 10, "hermes");
  const noted = await runMemoryEvent({ runtime: "hermes", promptRequests: true, directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1" }) });
  assert.match(String(noted.context), /Memory checkpoint due/);
  const again = await runMemoryEvent({ runtime: "hermes", promptRequests: true, directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t2" }) });
  assert.equal(again.context, undefined);
  assert.equal((await runMemoryEvent({ runtime: "hermes", promptRequests: true, directory, enabled: true, call, input: event("Stop") })).request, undefined);
}));

test("stages privately and only verified receipt flushes a checkpoint", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => isSave(name, args)
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64), closed: false }
    : {});
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-1", prompt: "Start" }) });
  const saved = checkpoint();
  assert.deepEqual(await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: saved } }), { staged: true, skipped: false });
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-1", checkpoint: bound(saved, "claude") });
  const stopped = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Stop") });
  assert.equal(stopped.request, undefined, "a pending checkpoint is flushed before Stop asks for continuation");
  assert.deepEqual(calls.filter(({ name, args }) => isSave(name, args)).map(({ args }) => args), [bound(saved, "claude")]);
  assert.equal((await readState(directory)).pending, undefined);
  assert.equal((await readState(directory)).acknowledged, "turn-1");
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("SessionStart") });
  assert.equal(calls.filter(({ name }) => name === "memory_read").length, 2, "resume reloads the Now index after context loss");
  assert.equal(calls.filter(({ name }) => name === "recall").at(-1)?.args.query, "Checkpoint", "resume retrieves the saved handoff topic");
}));

test("failed flush and malformed receipt retain the same request for retry", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let attempts = 0;
  const call = caller(calls, async (name, args) => {
    if (!isSave(name, args)) return {};
    attempts++;
    if (attempts === 1) throw new Error("temporary transport failure");
    if (attempts === 2) return { saved: true, request_id: args.request_id, note_id: "note-1", revision: 1 };
    return { saved: true, request_id: args.request_id, note_id: "note-1", revision: "b".repeat(64), closed: false };
  });
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-1" }) });
  const saved = checkpoint();
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: saved } });
  const failed = await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("Stop") });
  assert.match(String(failed.warning), /UNSAVED/);
  const retained = async () => { const { turn, checkpoint } = (await readState(directory)).pending as Record<string, unknown>; return { turn, checkpoint }; };
  assert.deepEqual(await retained(), { turn: "turn-1", checkpoint: bound(saved, "hermes") });

  const malformed = await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-2" }) });
  assert.match(String(malformed.warning), /UNSAVED/);
  assert.deepEqual(await retained(), { turn: "turn-1", checkpoint: bound(saved, "hermes") });
  assert.equal(((await readState(directory)).pending as { failure: { category: string } }).failure.category, "invalid_receipt");
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("Stop") });
  const writes = calls.filter(({ name, args }) => isSave(name, args));
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map(({ args }) => args), [bound(saved, "hermes"), bound(saved, "hermes"), bound(saved, "hermes")]);
  assert.equal((await readState(directory)).pending, undefined);
  assert.equal((await readState(directory)).acknowledged, "turn-1");
}));

test("explicit skip acknowledges a turn and restarts the activity count", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-skip" }) });
  await tools(directory, call);
  assert.deepEqual(await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { skip: "No durable changes" } }), { staged: false, skipped: true });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).request, undefined);
  assert.equal((await readState(directory)).tools, 0);
}));

test("stop hook guard, session mismatch, pending overwrite, and disabled mode are safe", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  const disabledDir = join(directory, "disabled");
  assert.deepEqual(await runMemoryEvent({ runtime: "codex", directory: disabledDir, enabled: false, call, input: event("UserPromptSubmit", { prompt: "No I/O" }) }), {});
  await assert.rejects(() => stat(disabledDir), { code: "ENOENT" });
  assert.equal(calls.length, 0);

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-guard" }) });
  await tools(directory, call);
  assert.match(String((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).request), /Memory checkpoint due/);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop", { stop_hook_active: true }) })).request, undefined);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).request, undefined);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { skip: "reset" } });
  await tools(directory, call);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop", { stop_hook_active: true }) })).request, undefined, "an active continuation never blocks again");

  const mismatch = checkpoint("other-session");
  await assert.rejects(() => runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-stage" }) }).then(() => runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: mismatch } })), /session mismatch/);
  const valid = checkpoint();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: valid } });
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: checkpoint() } }), /Unsaved checkpoint exists/);
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: {
    finish: { expected_revision: "c".repeat(64) },
  } }), /Unsaved checkpoint exists/, "finish cannot silently replace a pending save");
}));

test("a conflict replacement must identify the pending request and carry a fresh revision", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => isSave(name, args)
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "c".repeat(64), closed: false }
    : {});
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-conflict" }) });
  const pending = checkpoint();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: pending } });
  const replacement = { ...checkpoint(), expected_revision: "d".repeat(64) };
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: replacement, replaces_request_id: "wrong-request" } }), /Unsaved checkpoint exists/);
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: { ...replacement, expected_revision: null }, replaces_request_id: pending.request_id } }), /Unsaved checkpoint exists/);
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-conflict", checkpoint: bound(pending) });

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: replacement, replaces_request_id: pending.request_id } });
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-conflict", checkpoint: { ...bound(replacement), reopen: true } }, "a save onto an existing revision carries reopen");
  const result = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") });
  assert.equal(result.saved, true);
  assert.equal(result.pending, false);
  assert.equal((await readState(directory)).pending, undefined);
  assert.deepEqual(calls.filter(({ name, args }) => isSave(name, args)).map(({ args }) => args), [{ ...bound(replacement), reopen: true }]);
}));

test("Checkpoint reports pending until a verified receipt, and compaction or interrupt warns when unstaged", async () => withPrivateDirectory(async (directory) => {
  let writes = 0;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => {
    if (!isSave(name, args)) return {};
    writes++;
    if (writes === 1) throw new Error("offline");
    return { saved: true, request_id: args.request_id, note_id: "note-1", revision: "e".repeat(64), closed: false };
  });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-pending" }) });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: checkpoint() } });
  const pending = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  assert.equal(pending.saved, false);
  assert.equal(pending.pending, true);
  assert.match(String(pending.warning), /UNSAVED/);
  const saved = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  assert.equal(saved.saved, true);
  assert.equal(saved.pending, false);

  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-uncheckpointed" }) });
  await tools(directory, call, 10, "claude");
  for (const hook_event_name of ["PreCompact", "Interrupt"]) {
    const warning = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event(hook_event_name) });
    assert.match(String(warning.warning), /No checkpoint is staged/);
  }
}));

const minimal = { role: "overview", subject: "Alpha", title: "Alpha", content: "# Alpha\nNext: continue" };
async function stageMinimal(directory: string, call: MemoryCall, checkpointOverrides: Record<string, unknown> = {}) {
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1" }) });
  return runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: { ...minimal, ...checkpointOverrides }, now_line: "ship it" } });
}

test("a minimal checkpoint gets the hook session, a request id and a null revision, then flushes", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => isSave(name, args)
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64), closed: false } : { note: null, revision: null });
  assert.deepEqual(await stageMinimal(directory, call), { staged: true, skipped: false });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  const write = calls.find(({ name, args }) => isSave(name, args))!.args;
  assert.equal(write.session_id, "session-1");
  assert.equal(write.expected_revision, null);
  assert.match(String(write.request_id), /^[0-9a-f-]{36}$/);
  assert.equal((await readState(directory)).pending, undefined);
}));

test("a minimal checkpoint for an existing thread is rejected with its revision and stages nothing", async () => withPrivateDirectory(async (directory) => {
  const revision = "b".repeat(64);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => name === "memory_session" && args.action === "read" ? { note: { content: "old" }, revision } : {});
  await assert.rejects(() => stageMinimal(directory, call), (error: Error) => error instanceof MemoryClientError && error.message.includes(revision));
  assert.equal((await readState(directory)).pending, undefined);
  assert.equal(calls.some(({ name, args }) => isSave(name, args)), false);
}));

test("an explicit expected_revision is passed through without a read", async () => withPrivateDirectory(async (directory) => {
  const revision = "c".repeat(64);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await stageMinimal(directory, caller(calls), { expected_revision: revision });
  assert.equal(calls.some(({ name, args }) => name === "memory_session" && args.action === "read"), false, "no session read when the agent supplies the revision");
  const pending = (await readState(directory)).pending as { checkpoint: Record<string, unknown> };
  assert.equal(pending.checkpoint.expected_revision, revision);
  assert.equal(pending.checkpoint.session_id, "session-1");
}));

test("unchanged checkpoints skip remote calls and completion can flush below the activity threshold", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const revision = "f".repeat(64);
  const call = caller(calls, async (name, args) => isSave(name, args)
    ? { saved: true, request_id: args.request_id, note_id: "fixture-note", revision, closed: args.action === "finish", retained_note_id: null }
    : { note: null, revision: null });
  await stageMinimal(directory, call);
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  const before = calls.length;
  const skipped = await stageMinimal(directory, call, { expected_revision: revision });
  assert.deepEqual(skipped, { staged: false, skipped: true });
  assert.equal(calls.length, before, "unchanged content/status with a known revision costs no server call");
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint"), stage: { finish: { expected_revision: revision } } });
  const finished = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  assert.equal(finished.saved, true);
  assert.equal(calls.at(-1)?.args.action, "finish");
  assert.equal((await readState(directory)).lastCheckpoint, undefined);
}));

test("finish retries keep their identity and malformed completion receipts cannot drop pending data", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let attempts = 0;
  const call = caller(calls, async (name, args) => {
    if (!isSave(name, args)) return {};
    attempts++;
    if (attempts === 1) return { saved: true, request_id: args.request_id, note_id: null, revision: null, closed: false };
    return { saved: true, request_id: args.request_id, note_id: null, revision: null, closed: true, retained_note_id: null };
  });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit") });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { finish: { expected_revision: null } } });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") })).pending, true);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") })).pending, false);
  const writes = calls.filter(({ name, args }) => isSave(name, args));
  assert.deepEqual(writes[0].args, writes[1].args);
}));

test("explicit finish can resolve a pending save while retaining its private content until completion succeeds", async () => withPrivateDirectory(async (directory) => {
  let offline = true;
  const call: MemoryCall = async (name, args) => {
    if (name === "memory_session" && args.action === "finish") {
      if (offline) throw new Error("offline");
      return { saved: true, request_id: args.request_id, note_id: "fixture", revision: "e".repeat(64), closed: true, retained_note_id: null };
    }
    return {};
  };
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit") });
  const saved = checkpoint();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: saved } });
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { finish: { expected_revision: null }, replaces_request_id: saved.request_id } }), /Unsaved checkpoint exists/);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { finish: { expected_revision: "d".repeat(64) }, replaces_request_id: saved.request_id } });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") })).pending, true);
  const pending = (await readState(directory)).pending as { superseded: { content: string } };
  assert.equal(pending.superseded.content, saved.content);
  offline = false;
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") })).pending, false);
  assert.equal((await readState(directory)).pending, undefined);
}));

test("a lock left by a dead hook is reclaimed, while a live holder still reports busy", async () => withPrivateDirectory(async (directory) => {
  const file = join(directory, "profile.lock");
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
  await writeFile(file, dead, { mode: 0o600 });
  assert.equal(await withPrivateLock(file, async () => "ran"), "ran");
  await assert.rejects(stat(file), { code: "ENOENT" }, "the reclaimed lock is released");
  await writeFile(file, String(process.pid), { mode: 0o600 });
  await assert.rejects(withPrivateLock(file, async () => "ran"), MemoryClientError);
  await utimes(file, new Date(0), new Date(0));
  assert.equal(await withPrivateLock(file, async () => "ran"), "ran", "an expired lock is reclaimed even when its PID is live");
}));

test("the project resolves once per session and scopes Agent Now order, recall and staged checkpoints", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  let resolved = 0;
  const resolveProject = (cwd: string | undefined) => { resolved++; return cwd === "/work/atlas" ? "atlas" : undefined; };
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, resolveProject, input: event("SessionStart", { cwd: "/work/atlas", prompt: "Resume" }) });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, resolveProject, input: event("UserPromptSubmit", { cwd: "/elsewhere", turn_id: "turn-1" }) });
  assert.equal(resolved, 1);
  assert.deepEqual(calls[0], { name: "memory_read", args: { role: "overview", subject: "Agent Now", session_id: "session-1" } }, "Agent Now is global; the project only orders it");
  assert.match(String(calls.find(({ name }) => name === "recall")!.args.query), /^atlas Resume/);
  const result = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, resolveProject, input: event("Checkpoint"),
    stage: { checkpoint: { title: "Atlas", content: "Progress", expected_revision: null } } });
  assert.equal(result.staged, true);
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call: caller(calls, async (_name, args) => ({ saved: true, request_id: args.request_id, note_id: "n", revision: "a".repeat(64), closed: false })), resolveProject, input: event("Checkpoint") });
  assert.equal(calls.find(({ name, args }) => isSave(name, args))!.args.project, "atlas");
}));

test("staging continue joins another session's checkpoint and returns it for merging", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (_name, args) => args.action === "continue"
    ? { saved: true, request_id: args.request_id, note_id: "shared", revision: "b".repeat(64), closed: false }
    : { note: { title: "Shared (claude-abc)", content: "Claude progress" }, revision: "b".repeat(64), closed: false });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-1" }) });
  const result = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { continue: { title: "Shared (claude-abc)" } } });
  assert.equal(result.continued, true);
  assert.deepEqual(result.note, { title: "Shared (claude-abc)", content: "Claude progress" });
  assert.equal(calls.find(({ args }) => args.action === "continue")!.args.title, "Shared (claude-abc)");
  assert.equal((await readState(directory)).pending, undefined, "continuing stages nothing");
}));

test("a finished checkpoint is kept, so restaging must merge it; only a trashed one is replaced", async () => {
  const revision = "c".repeat(64);
  const stage = { checkpoint: { title: "Resumed", content: "New work" } };
  const kept: MemoryCall = async () => ({ note: { content: "Finished record" }, revision, closed: true });
  await assert.rejects(() => prepareSessionStage(kept, "claude", "session-1", stage), /already exists at revision/);
  const trashed: MemoryCall = async () => ({ note: null, revision, closed: true });
  const staged = await prepareSessionStage(trashed, "claude", "session-1", stage);
  assert.equal(staged.checkpoint!.expected_revision, revision);
});

test("staging accepts expected_revision beside the checkpoint as well as inside it", async () => {
  const revision = "d".repeat(64);
  const unread: MemoryCall = async () => { throw new Error("a supplied revision needs no read"); };
  const staged = await prepareSessionStage(unread, "claude", "session-1", { checkpoint: { title: "Resumed", content: "Merged" }, expected_revision: revision });
  assert.equal(staged.checkpoint!.expected_revision, revision);
  await assert.rejects(() => prepareSessionStage(unread, "claude", "session-1", { checkpoint: { title: "Resumed", content: "Merged", expected_revision: revision }, expected_revision: "e".repeat(64) }), /expected_revision/);
});

// Session server with the real rules: changing revisions, stale-revision rejection and request replay.
function sessionServer() {
  const store = { revision: null as string | null, version: 0, mutations: 0, receipts: new Map<string, Record<string, unknown>>(), loseResponses: 0, offline: false };
  const call: MemoryCall = async (name, args) => {
    if (name !== "memory_session" || args.action === "read") return {};
    if (store.offline) throw new Error("offline");
    const request_id = String(args.request_id);
    let receipt = store.receipts.get(request_id);
    if (!receipt) {
      if (args.expected_revision !== store.revision) throw new MemoryClientError("Session memory conflict: stale revision.", { category: "conflict", phase: "call" });
      store.mutations++;
      store.version++;
      store.revision = args.action === "finish" ? store.revision : String(store.version).padStart(64, "0");
      receipt = { saved: true, request_id, note_id: args.action === "finish" && store.version === 0 ? null : "note-1", revision: store.revision, closed: args.action === "finish" };
      store.receipts.set(request_id, receipt);
    }
    if (store.loseResponses > 0) { store.loseResponses--; throw new Error("response lost"); }
    return receipt;
  };
  return { store, call };
}
const runner = (runtime: "codex" | "claude" | "hermes", directory: string, call: MemoryCall) =>
  (hook: string, overrides: Partial<HookInput> = {}, extra: object = {}) => runMemoryEvent({ runtime, directory, enabled: true, call, input: event(hook, overrides), ...extra });
const additionalContext = (output: Record<string, unknown>) => String(output.context ?? "");

for (const runtime of ["codex", "claude", "hermes"] as const) {
  test(`${runtime}: a receipt saved by a background retry reaches the next prompt context, survives replay, and the next save works`, async () => withPrivateDirectory(async (directory) => {
    const { store, call } = sessionServer();
    const run = runner(runtime, directory, call);
    await run("UserPromptSubmit", { turn_id: "t1" });
    store.offline = true;
    const saved = checkpoint();
    await run("Checkpoint", {}, { stage: { checkpoint: saved } });
    assert.match(String((await run("Checkpoint")).warning), /UNSAVED/, "the first attempt fails");

    store.offline = false;
    const stopped = await run("Stop");
    assert.equal(additionalContext(stopped), "", "Stop output cannot reach the model, so nothing is promised there");
    assert.equal(store.mutations, 1);
    const persisted = (await readState(directory)).receipt as Record<string, unknown>;
    assert.equal(persisted.request_id, saved.request_id);
    assert.equal(persisted.revision, store.revision);

    const prompt = additionalContext(await run("UserPromptSubmit", { turn_id: "t2" }));
    assert.match(prompt, new RegExp(saved.request_id));
    assert.match(prompt, new RegExp(String(store.revision)));
    assert.match(prompt, /read the current checkpoint/i);
    assert.equal(additionalContext(await run("UserPromptSubmit", { turn_id: "t3" })), "", "delivered once per prompt");
    assert.ok((await readState(directory)).receipt, "emission does not delete the only verified metadata");

    const calls = store.mutations;
    if (runtime !== "hermes") { // Hermes has no start event: its receipt is delivered once at the next pre_llm_call.
      const resumed = additionalContext(await run("SessionStart"));
      assert.match(resumed, new RegExp(saved.request_id), "resume or compaction replays it without extra turns");
      assert.equal(store.mutations, calls, "replay makes no remote write");
    }

    const next = { ...checkpoint(), content: "More work", expected_revision: store.revision };
    await run("Checkpoint", {}, { stage: { checkpoint: next } });
    assert.equal((await run("Checkpoint")).pending, false);
    assert.equal(((await readState(directory)).receipt as Record<string, unknown>).request_id, next.request_id, "only the latest receipt is retained");
  }));
}

test("a committed save whose response is lost replays the original request once and surfaces its receipt", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = sessionServer();
  const run = runner("claude", directory, call);
  await run("UserPromptSubmit", { turn_id: "t1" });
  store.loseResponses = 1;
  const saved = checkpoint();
  await run("Checkpoint", {}, { stage: { checkpoint: saved } });
  const first = await run("Checkpoint");
  assert.match(String(first.warning), /unverified/i, "a lost response is unverified, not proof nothing saved");
  assert.equal(store.mutations, 1);
  await run("Stop");
  assert.equal(store.mutations, 1, "the identical request replays instead of writing twice");
  assert.match(additionalContext(await run("UserPromptSubmit", { turn_id: "t2" })), new RegExp(saved.request_id));
}));

test("stage output shows the receipt, and a no-note finish receipt is described without inventing a note", async () => withPrivateDirectory(async (directory) => {
  const call: MemoryCall = async (name, args) => isSave(name, args) ? { saved: true, request_id: args.request_id, note_id: null, revision: null, closed: true, retained_note_id: null } : {};
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { finish: { expected_revision: null } } });
  const flushed = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") });
  assert.equal(flushed.pending, false);
  const receipt = (await readState(directory)).receipt as Record<string, unknown>;
  assert.deepEqual([receipt.note_id, receipt.revision, receipt.closed], [null, null, true]);
  const notice = additionalContext(await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("SessionStart") }));
  assert.match(notice, /no note/i);
  assert.equal(notice.includes("null"), false);
}));

test("a receipt describes a past save: another contributor's later edit still requires a current read", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = sessionServer();
  const run = runner("codex", directory, call);
  await run("UserPromptSubmit", { turn_id: "t1" });
  await run("Checkpoint", {}, { stage: { checkpoint: checkpoint() } });
  await run("Checkpoint");
  const receiptRevision = store.revision;
  store.version++; store.revision = String(store.version).padStart(64, "0"); // another contributor
  const notice = additionalContext(await run("SessionStart"));
  assert.match(notice, new RegExp(String(receiptRevision)));
  assert.equal(notice.includes(String(store.revision)), false);
  assert.match(notice, /may have changed|not the current/i);
  const stale = { ...checkpoint(), content: "Edited after receipt", expected_revision: receiptRevision };
  await run("Checkpoint", {}, { stage: { checkpoint: stale } });
  assert.match(String((await run("Checkpoint")).warning), /UNSAVED/, "the historical receipt never bypasses the revision check");
}));

test("a receipt is never shown to another session", async () => withPrivateDirectory(async (directory) => {
  const { call } = sessionServer();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: checkpoint() } });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") });
  const other = additionalContext(await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("SessionStart", { session_id: "session-2" }) }));
  assert.doesNotMatch(other, /request_id|revision/i);
}));

test("a confirmed conflict is preserved for recovery and not resent, while transient failures keep retrying", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = sessionServer();
  const run = runner("claude", directory, call);
  await run("UserPromptSubmit", { turn_id: "t1" });
  const stale = { ...checkpoint(), request_id: undefined, expected_revision: "f".repeat(64) };
  store.offline = true;
  await run("Checkpoint", {}, { stage: { checkpoint: stale } });
  assert.equal(((await run("Checkpoint")).pending_request as { failure: { category: string } }).failure.category, "unknown");
  store.offline = false;
  assert.equal(additionalContext(await run("Stop")), "", "the background retry finds the conflict");
  let resent = 0;
  const counting: MemoryCall = async (name, args) => { if (isSave(name, args)) resent++; return call(name, args); };
  const later = runner("claude", directory, counting);
  const prompt = await later("UserPromptSubmit", { turn_id: "t2" });
  assert.match(additionalContext(prompt), /UNSAVED \(conflict, rejected as stale\): request_id [0-9a-f-]{36}, attempted revision f{64}/, "model context names the pending request");
  assert.match(additionalContext(prompt), /merge/);
  assert.equal(additionalContext(await later("UserPromptSubmit", { turn_id: "t3" })), "", "the recovery notice is delivered once per prompt, not looped");
  await later("Stop");
  await later("PreCompact");
  const failed = await later("Checkpoint");
  const pending = failed.pending_request as { request_id: string; attempted_revision: string; failure: { category: string }; recovery: string };
  assert.equal(failed.pending, true);
  assert.match(pending.request_id, /^[0-9a-f-]{36}$/, "the generated request ID is returned to the agent");
  assert.equal(pending.attempted_revision, "f".repeat(64));
  assert.equal(pending.failure.category, "conflict");
  assert.match(pending.recovery, /inspect/);
  assert.match(pending.recovery, new RegExp(`"replaces_request_id": "${pending.request_id}"`));
  assert.match(String(failed.warning), /stale/i);
  assert.doesNotMatch(String(failed.warning), /may have committed/, "a confirmed rejection is not described as unverified");

  assert.match(additionalContext(prompt), new RegExp(pending.request_id));
  assert.equal(resent, 0, "a confirmed stale request is not resent at every hook");
  assert.match(additionalContext(await later("SessionStart")), new RegExp(pending.request_id), "a start replays it");

}));

test("a transient failure keeps the original request for retry and says it is unverified", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = sessionServer();
  const run = runner("codex", directory, call);
  await run("UserPromptSubmit", { turn_id: "t1" });
  store.offline = true;
  await run("Checkpoint", {}, { stage: { checkpoint: checkpoint() } });
  const failed = await run("Checkpoint");
  const pending = failed.pending_request as { failure: { category: string } };
  assert.equal(pending.failure.category, "unknown", "an unclassified error stays explicitly unknown");
  assert.match(String(failed.warning), /unverified/);
  store.offline = false;
  await run("Stop");
  assert.equal(store.mutations, 1, "the Stop retry resends the original request");
}));

test("a conflicted request is replaced only by a fresh revision naming it; rejections are actionable and change nothing", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = sessionServer();
  const run = runner("codex", directory, call);
  await run("UserPromptSubmit", { turn_id: "t1" });
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Created", content: "First" }, expected_revision: null } });
  await run("Checkpoint");
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Stale", content: "Mine" }, expected_revision: "f".repeat(64) } });
  const { request_id } = (await run("Checkpoint")).pending_request as { request_id: string };
  const before = await readState(directory);
  const mutations = store.mutations;
  for (const stage of [
    { checkpoint: { title: "Stale", content: "Merged" }, expected_revision: "f".repeat(64), replaces_request_id: request_id },
    { checkpoint: { title: "Stale", content: "Merged" }, expected_revision: store.revision, replaces_request_id: "wrong" },
    { checkpoint: { title: "Stale", content: "Merged" }, expected_revision: store.revision },
    { checkpoint: { title: "Stale", content: "Merged", request_id }, expected_revision: store.revision, replaces_request_id: request_id },
  ]) {
    await assert.rejects(() => run("Checkpoint", {}, { stage }), (error) => error instanceof MemoryClientError && error.message.includes(request_id) && /replaces_request_id/.test(error.message));
  }
  assert.deepEqual(await readState(directory), before, "a rejected replacement leaves pending state intact");
  assert.equal(store.mutations, mutations);
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Stale", content: "First + Mine" }, expected_revision: store.revision, replaces_request_id: request_id } });
  const saved = await run("Checkpoint");
  assert.deepEqual([saved.saved, saved.pending], [true, false]);
}));

test("inspect is read-only, offline and scoped to one session's pending contribution and receipt", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = sessionServer();
  const mine = runner("codex", directory, call);
  await mine("UserPromptSubmit", { turn_id: "t1" });
  await mine("Checkpoint", {}, { stage: { checkpoint: { title: "Saved", content: "First" }, expected_revision: null } });
  await mine("Checkpoint");
  store.offline = true;
  await mine("Checkpoint", {}, { stage: { checkpoint: { title: "Saved", content: "MY-PENDING-BODY" }, expected_revision: store.revision } });
  await mine("Checkpoint");
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { session_id: "session-2", turn_id: "t1" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint", { session_id: "session-2" }), stage: { checkpoint: { title: "Other", content: "OTHER-BODY" }, expected_revision: null } });

  const files = async () => Promise.all((await readdir(directory)).filter((file) => file.endsWith(".json")).map((file) => readFile(join(directory, file), "utf8")));
  const before = await files();
  const inspected = await inspectMemoryState({ runtime: "codex", directory, session_id: "session-1" });
  assert.deepEqual(await files(), before, "inspect writes nothing and acknowledges nothing");
  const pending = inspected.pending as { request_id: string; checkpoint: { content: string }; failure: { category: string } };
  assert.equal(pending.checkpoint.content, "MY-PENDING-BODY");
  assert.equal(pending.failure.category, "unknown");
  assert.equal((inspected.receipt as { revision: string }).revision, store.revision);
  assert.equal(JSON.stringify(inspected).includes("OTHER-BODY"), false, "another session's contribution is never exposed");
  assert.equal(JSON.stringify(inspected).includes("announced"), false);
  assert.deepEqual(await inspectMemoryState({ runtime: "claude", directory, session_id: "session-1" }), { runtime: "claude", session_id: "session-1", pending: null, receipt: null }, "runtime is part of the scope");
  assert.deepEqual(await inspectMemoryState({ runtime: "codex", directory: join(directory, "missing"), session_id: "session-1" }), { runtime: "codex", session_id: "session-1", pending: null, receipt: null });
  await assert.rejects(() => stat(join(directory, "missing")), { code: "ENOENT" }, "inspect creates no state directory");
  await assert.rejects(() => inspectMemoryState({ runtime: "codex", directory, session_id: "session-1", binding: { endpoint: "https://other.test/mcp", principal_id: "p", area: "a" } }), /another connection/);
}));

test("a finish rejected for a stale retained-note revision is replaced by correcting that revision", async () => withPrivateDirectory(async (directory) => {
  let writes = 0;
  const call: MemoryCall = async (name, args) => {
    if (!isSave(name, args)) return {};
    writes++;
    const retain = args.retain as { expected_revision: string | null };
    if (retain.expected_revision !== "b".repeat(64)) throw new MemoryClientError("Session memory conflict.", { category: "conflict", phase: "call" });
    return { saved: true, request_id: args.request_id, note_id: "note-1", revision: "c".repeat(64), closed: true, retained_note_id: "wiki-1" };
  };
  const run = runner("codex", directory, call);
  await run("UserPromptSubmit", { turn_id: "t1" });
  const retain = { role: "wiki", subject: "Fact", title: "Fact", content: "Lasting", expected_revision: "a".repeat(64) };
  await run("Checkpoint", {}, { stage: { finish: { retain }, expected_revision: "c".repeat(64) } });
  const { request_id } = (await run("Checkpoint")).pending_request as { request_id: string };
  await run("Checkpoint", {}, { stage: { finish: { retain: { ...retain, expected_revision: "b".repeat(64) } }, expected_revision: "c".repeat(64), replaces_request_id: request_id } });
  assert.equal((await run("Checkpoint")).saved, true);
  assert.equal(writes, 2);
}));

test("inspect refuses a symlinked state file instead of following it to another session", async () => withPrivateDirectory(async (directory) => {
  const { call } = sessionServer();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { session_id: "session-2", turn_id: "t1" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint", { session_id: "session-2" }), stage: { checkpoint: { title: "Other", content: "OTHER-BODY" }, expected_revision: null } });
  const name = (session: string) => join(directory, `${createHash("sha256").update(`codex:${session}`).digest("hex")}.json`);
  await symlink(name("session-2"), name("session-1"));
  await assert.rejects(() => inspectMemoryState({ runtime: "codex", directory, session_id: "session-1" }), /symlink/);
  const linked = join(directory, "linked");
  await symlink(directory, linked);
  await assert.rejects(() => inspectMemoryState({ runtime: "codex", directory: linked, session_id: "session-2" }), /private/);
}));

test("conflict messages keep only a validated revision, never upstream text", () => {
  const revision = "a".repeat(64);
  const message = conflictMessage(`Session memory is at revision ${revision}; SECRET-BODY sk-sentinel`);
  assert.match(message, new RegExp(`revision ${revision}`));
  assert.equal(/SECRET|sentinel/.test(message), false);
  assert.match(conflictMessage("No session checkpoint exists yet; use expected_revision null to create it"), /expected_revision null/);
  assert.equal(conflictMessage("SECRET-BODY").includes("SECRET"), false);
});
