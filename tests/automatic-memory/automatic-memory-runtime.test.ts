import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type HookInput, type MemoryCall } from "../../scripts/memory/runtime";
import { MemoryClientError } from "../../scripts/memory/client-error";

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
  assert.deepEqual(calls[0], { name: "memory_read", args: { role: "overview", subject: "Now", session_id: "session-1" } });
  assert.equal(calls.filter(({ name }) => name === "recall").length, 1);
  assert.match(String((start.hookSpecificOutput as { additionalContext: string }).additionalContext), /Automatic memory:/);
  assert.equal((await stat(directory)).mode & 0o077, 0);

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-2", prompt: "Another prompt" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-3", prompt: "Again" }) });
  assert.deepEqual(calls.map(({ name }) => name), ["memory_read", "recall"]);
}));

test("Now is injected capped, and the instruction block appears once per session", async () => withPrivateDirectory(async (directory) => {
  const call = caller([], async (name) => name === "memory_read" ? { note: { content: "# Now\n" + "- [[Thread]] — x\n".repeat(400) }, revision: "a".repeat(64) } : {});
  const start = await runMemoryEvent({ runtime: "codex", directory: join(directory, "second"), enabled: true, call, input: event("SessionStart") });
  const context = (start.hookSpecificOutput as { additionalContext: string }).additionalContext;
  assert.ok(context.length < 2200, "Now plus instruction stays within a few hundred tokens");
  const next = await runMemoryEvent({ runtime: "codex", directory: join(directory, "second"), enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t2" }) });
  assert.equal(next.hookSpecificOutput, undefined, "no per-prompt instruction or Now re-injection");
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
  const call = caller(calls, async (name, args) => name === "memory_write"
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64) } : {});
  for (let turn = 1; turn <= 4; turn++) await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: `t${turn}` }) });
  const requested = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") });
  assert.equal(requested.decision, "block");
  assert.match(String(requested.reason), /Schema \(evidence/, "schema is delivered with the request");
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t5" }) });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined, "still one request until a save");

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: checkpoint() } });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") });
  const state = await readState(directory);
  assert.deepEqual([state.users, state.tools, state.dueRequested], [0, 0, false]);
  await tools(directory, call, 10);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, "block", "ten tool calls make a new checkpoint due");
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
    if (args.subject === "Now") {
      if (store.conflicts > 0) { store.conflicts--; store.content = (store.content ?? "# Now") + "\n- [[Other]] — concurrent"; rotate(); throw new Error("revision_conflict"); }
      if (args.expected_revision !== store.revision) throw new Error("revision_conflict");
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
const save = (directory: string, call: MemoryCall, title: string, now_line: string, session_id = "session-1", runtime: "codex" | "claude" = "codex") =>
  runMemoryEvent({ runtime, directory, enabled: true, call, input: event("UserPromptSubmit", { session_id, turn_id: `turn-${title}` }) })
    .then(() => runMemoryEvent({ runtime, directory, enabled: true, call, input: event("Checkpoint", { session_id }), stage: { checkpoint: thread(title, session_id), now_line } }))
    .then(() => runMemoryEvent({ runtime, directory, enabled: true, call, input: event("Checkpoint", { session_id }) }));

test("saves from two runtimes both appear in Now, newest first, one line per thread, capped", async () => withPrivateDirectory(async (directory) => {
  const { store, call } = nowServer();
  await save(join(directory, "codex"), call, "Alpha", "ship the gate");
  await save(join(directory, "claude"), call, "Beta", "review", "session-2", "claude");
  await save(join(directory, "codex"), call, "Alpha", "done");
  const lines = store.content!.split("\n").filter((line) => line.startsWith("- [["));
  assert.deepEqual(lines, ["- [[Alpha]] — done", "- [[Beta]] — review"]);
  assert.match(store.content!, /^# Now\n/);
  for (let i = 0; i < 20; i++) await save(join(directory, "codex"), call, `Thread ${i}`, "x");
  assert.equal(store.content!.split("\n").filter((line) => line.startsWith("- [[")).length, 15);
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
    await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: `turn-${i}` }) });
    await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: saved, now_line: "ship" } });
    await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") });
  }
  assert.equal(store.content!.match(/\[\[Alpha\]\]/g)?.length, 1);
  assert.equal(store.writes, 1, "the unchanged line is not rewritten");
}));

test("now_line requires an overview checkpoint and a plain single line", async () => withPrivateDirectory(async (directory) => {
  const call = caller([]);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t" }) });
  for (const stage of [
    { checkpoint: checkpoint(), now_line: "ok" },
    { checkpoint: thread("Alpha"), now_line: "two\nlines" },
    { checkpoint: thread("Alpha"), now_line: "[[link]]" },
    { checkpoint: thread("A]]B"), now_line: "ok" },
  ]) await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage }));
}));

test("Hermes injects the checkpoint-due note once instead of blocking at prompt time", async () => withPrivateDirectory(async (directory) => {
  const call = caller([]);
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t0" }) });
  await tools(directory, call, 10, "hermes");
  const noted = await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1" }) });
  assert.match(String((noted.hookSpecificOutput as { additionalContext: string }).additionalContext), /Memory checkpoint due/);
  const again = await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t2" }) });
  assert.equal(again.hookSpecificOutput, undefined);
  assert.equal((await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("Stop") })).decision, undefined);
}));

test("stages privately and only verified receipt flushes a checkpoint", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => name === "memory_write"
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64) }
    : {});
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-1", prompt: "Start" }) });
  const saved = checkpoint();
  assert.deepEqual(await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: saved } }), { staged: true, skipped: false });
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-1", checkpoint: saved });
  const stopped = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Stop") });
  assert.equal(stopped.decision, undefined, "a pending checkpoint is flushed before Stop asks for continuation");
  assert.deepEqual(calls.filter(({ name }) => name === "memory_write").map(({ args }) => args), [saved]);
  assert.equal((await readState(directory)).pending, undefined);
  assert.equal((await readState(directory)).acknowledged, "turn-1");
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("SessionStart") });
  assert.equal(calls.filter(({ name }) => name === "memory_read").length, 2, "resume reloads the Now index after context loss");
  assert.equal(calls.filter(({ name }) => name === "recall").at(-1)?.args.query, "task", "resume retrieves the saved handoff topic");
}));

test("failed flush and malformed receipt retain the same request for retry", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let attempts = 0;
  const call = caller(calls, async (name, args) => {
    if (name !== "memory_write") return {};
    attempts++;
    if (attempts === 1) throw new Error("temporary transport failure");
    if (attempts === 2) return { saved: true, request_id: args.request_id, note_id: "note-1", revision: 1 };
    return { saved: true, request_id: args.request_id, note_id: "note-1", revision: "b".repeat(64) };
  });
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-1" }) });
  const saved = checkpoint();
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: saved } });
  const failed = await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("Stop") });
  assert.match(String(failed.systemMessage), /UNSAVED/);
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-1", checkpoint: saved });

  const malformed = await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-2" }) });
  assert.match(String(malformed.systemMessage), /UNSAVED/);
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-1", checkpoint: saved });
  await runMemoryEvent({ runtime: "hermes", directory, enabled: true, call, input: event("Stop") });
  const writes = calls.filter(({ name }) => name === "memory_write");
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map(({ args }) => args), [saved, saved, saved]);
  assert.equal((await readState(directory)).pending, undefined);
  assert.equal((await readState(directory)).acknowledged, "turn-1");
}));

test("explicit skip acknowledges a turn and restarts the activity count", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-skip" }) });
  await tools(directory, call);
  assert.deepEqual(await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { skip: "No durable changes" } }), { staged: false, skipped: true });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined);
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
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, "block");
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop", { stop_hook_active: true }) })).decision, undefined);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint"), stage: { skip: "reset" } });
  await tools(directory, call);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop", { stop_hook_active: true }) })).decision, undefined, "an active continuation never blocks again");

  const mismatch = checkpoint("other-session");
  await assert.rejects(() => runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-stage" }) }).then(() => runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: mismatch } })), /session mismatch/);
  const valid = checkpoint();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: valid } });
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: checkpoint() } }), /Unsaved checkpoint exists/);
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: {
    replaces_request_id: valid.request_id,
    checkpoint: { ...checkpoint(), subject: "unrelated-topic", expected_revision: "c".repeat(64) },
  } }), /Unsaved checkpoint exists/, "conflict resolution cannot discard a pending contribution for another subject");
}));

test("a conflict replacement must identify the pending request and carry a fresh revision", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => name === "memory_write"
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "c".repeat(64) }
    : {});
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-conflict" }) });
  const pending = checkpoint();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: pending } });
  const replacement = { ...checkpoint(), expected_revision: "d".repeat(64) };
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: replacement, replaces_request_id: "wrong-request" } }), /Unsaved checkpoint exists/);
  await assert.rejects(() => runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: { ...replacement, expected_revision: null }, replaces_request_id: pending.request_id } }), /Unsaved checkpoint exists/);
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-conflict", checkpoint: pending });

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: replacement, replaces_request_id: pending.request_id } });
  assert.deepEqual((await readState(directory)).pending, { turn: "turn-conflict", checkpoint: replacement });
  assert.deepEqual(await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Checkpoint") }), { saved: true, pending: false });
  assert.equal((await readState(directory)).pending, undefined);
  assert.deepEqual(calls.filter(({ name }) => name === "memory_write").map(({ args }) => args), [replacement]);
}));

test("Checkpoint reports pending until a verified receipt, and compaction or interrupt warns when unstaged", async () => withPrivateDirectory(async (directory) => {
  let writes = 0;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => {
    if (name !== "memory_write") return {};
    writes++;
    if (writes === 1) throw new Error("offline");
    return { saved: true, request_id: args.request_id, note_id: "note-1", revision: "e".repeat(64) };
  });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-pending" }) });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("PostToolUse"), stage: { checkpoint: checkpoint() } });
  const pending = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  assert.equal(pending.saved, false);
  assert.equal(pending.pending, true);
  assert.match(String(pending.systemMessage), /UNSAVED/);
  const saved = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  assert.deepEqual(saved, { saved: true, pending: false });

  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-uncheckpointed" }) });
  await tools(directory, call, 10, "claude");
  for (const hook_event_name of ["PreCompact", "Interrupt"]) {
    const warning = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event(hook_event_name) });
    assert.match(String(warning.systemMessage), /No checkpoint is staged/);
  }
}));

const minimal = { role: "overview", subject: "Alpha", title: "Alpha", content: "# Alpha\nNext: continue" };
async function stageMinimal(directory: string, call: MemoryCall, checkpointOverrides: Record<string, unknown> = {}) {
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "t1" }) });
  return runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint"), stage: { checkpoint: { ...minimal, ...checkpointOverrides }, now_line: "ship it" } });
}

test("a minimal checkpoint gets the hook session, a request id and a null revision, then flushes", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name, args) => name === "memory_write"
    ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64) } : { note: null, revision: null });
  assert.deepEqual(await stageMinimal(directory, call), { staged: true, skipped: false });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event("Checkpoint") });
  const write = calls.find(({ name, args }) => name === "memory_write" && args.subject === "Alpha")!.args;
  assert.equal(write.session_id, "session-1");
  assert.equal(write.expected_revision, null);
  assert.match(String(write.request_id), /^[0-9a-f-]{36}$/);
  assert.equal((await readState(directory)).pending, undefined);
}));

test("a minimal checkpoint for an existing thread is rejected with its revision and stages nothing", async () => withPrivateDirectory(async (directory) => {
  const revision = "b".repeat(64);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls, async (name) => name === "memory_read" ? { note: { content: "old" }, revision } : {});
  await assert.rejects(() => stageMinimal(directory, call), (error: Error) => error instanceof MemoryClientError && error.message.includes(revision));
  assert.equal((await readState(directory)).pending, undefined);
  assert.equal(calls.some(({ name }) => name === "memory_write"), false);
}));

test("an explicit expected_revision is passed through without a read", async () => withPrivateDirectory(async (directory) => {
  const revision = "c".repeat(64);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await stageMinimal(directory, caller(calls), { expected_revision: revision });
  assert.equal(calls.some(({ name, args }) => name === "memory_read" && args.subject === "Alpha"), false, "no thread read when the agent supplies the revision");
  const pending = (await readState(directory)).pending as { checkpoint: Record<string, unknown> };
  assert.equal(pending.checkpoint.expected_revision, revision);
  assert.equal(pending.checkpoint.session_id, "session-1");
}));
