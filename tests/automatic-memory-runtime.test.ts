import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type HookInput, type MemoryCall } from "../scripts/memory/runtime";

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

test("loads schema and first prompt recall once, from private state", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  const start = await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("SessionStart", { prompt: "Resume the memory work" }) });
  assert.equal(calls.filter(({ name }) => name === "get_knowledge_schema").length, 1);
  assert.equal(calls.filter(({ name }) => name === "recall").length, 1);
  assert.match(String((start.hookSpecificOutput as { additionalContext: string }).additionalContext), /Retrieved schema/);
  assert.equal((await stat(directory)).mode & 0o077, 0);

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-2", prompt: "Another prompt" }) });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-3", prompt: "Again" }) });
  assert.deepEqual(calls.map(({ name }) => name), ["get_knowledge_schema", "recall"]);
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
  assert.equal(calls.filter(({ name }) => name === "get_knowledge_schema").length, 2, "resume reloads schema after context loss");
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

test("explicit skip acknowledges a turn, while a missing checkpoint requests continuation once", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-skip" }) });
  assert.deepEqual(await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("PostToolUse"), stage: { skip: "No durable changes" } }), { staged: false, skipped: true });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined);

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-missing" }) });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, "block");
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined);
}));

test("stop hook guard, session mismatch, pending overwrite, and disabled mode are safe", async () => withPrivateDirectory(async (directory) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const call = caller(calls);
  const disabledDir = join(directory, "disabled");
  assert.deepEqual(await runMemoryEvent({ runtime: "codex", directory: disabledDir, enabled: false, call, input: event("UserPromptSubmit", { prompt: "No I/O" }) }), {});
  await assert.rejects(() => stat(disabledDir), { code: "ENOENT" });
  assert.equal(calls.length, 0);

  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("UserPromptSubmit", { turn_id: "turn-guard" }) });
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, "block");
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop", { stop_hook_active: true }) })).decision, undefined);
  assert.equal((await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: event("Stop") })).decision, undefined);

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
  for (const hook_event_name of ["PreCompact", "Interrupt"]) {
    const warning = await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: event(hook_event_name) });
    assert.match(String(warning.systemMessage), /No checkpoint is staged/);
  }
}));
