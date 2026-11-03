import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type HookInput, type MemoryCall, type Runtime } from "../../scripts/memory/runtime";
import { MemoryClientError } from "../../scripts/memory/client-error";
import { conflictMessage, workstreamConflict } from "../../scripts/memory/connection";

async function withPrivateDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chibako-memory-continuity-"));
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
type Call = { name: string; args: Record<string, unknown> };
const hex = (char: string) => char.repeat(64);

// A server whose thread links resolve one shared checkpoint; continuity: 0 models an older server.
function server(options: { continuity?: boolean; checkpoint?: { title: string; content: string } | null; save?: (args: Record<string, unknown>) => Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const call: MemoryCall = async (name, args) => {
    calls.push({ name, args });
    if (name === "memory_status") return { contract_version: 1, session_lifecycle: 1, projects: 1, ...(options.continuity === false ? {} : { continuity: 1 }) };
    if (name === "memory_read") return { note: { content: "# Agent Now\n\n- [[Other]] — later" }, revision: hex("0") };
    if (name === "memory_session" && args.action === "read") {
      return options.checkpoint && args.thread_key ? { note: options.checkpoint, revision: hex("b"), closed: false } : { note: null, revision: null, closed: false };
    }
    if (name === "memory_session") return options.save?.(args) ?? { saved: true, request_id: args.request_id, note_id: "note-1", revision: hex("c"), closed: args.action === "finish", joined: false, title: args.title ?? null };
    return {};
  };
  return { calls, call };
}
function runner(directory: string, call: MemoryCall, thread?: { host: string; id: string }, runtime: Runtime = "claude", session_id = "session-1") {
  return (hook_event_name: string, overrides: Partial<HookInput> = {}, extra: object = {}) =>
    runMemoryEvent({ runtime, directory, enabled: true, call, input: { session_id, hook_event_name, ...overrides }, ...(thread ? { thread } : {}), ...extra });
}
const sessionCalls = (calls: Call[]) => calls.filter(({ name }) => name === "memory_session");

test("every session call carries a thread key derived locally from host and thread, never the raw id", async () => withPrivateDirectory(async (directory) => {
  const { calls, call } = server();
  const run = runner(directory, call, { host: "t3", id: "thread-raw-A" });
  await run("SessionStart");
  await run("UserPromptSubmit", { turn_id: "t1", prompt: "work" });
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Task", content: "Progress" } } });
  await run("Checkpoint");
  const session = sessionCalls(calls);
  assert.deepEqual(session.map(({ args }) => args.action), ["read", "read", "save"], "briefing read, stage read and the save");
  const keys = new Set(session.map(({ args }) => args.thread_key));
  assert.equal(keys.size, 1);
  assert.match(String([...keys][0]), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(calls).includes("thread-raw-A"), false, "the raw thread id never leaves the machine");

  const other = server();
  await runner(join(directory, "other"), other.call, { host: "t3", id: "thread-raw-B" })("SessionStart");
  assert.notEqual(sessionCalls(other.calls)[0].args.thread_key, [...keys][0], "another thread gets another key");
}));

test("against a server without continuity, no thread key is sent and no checkpoint is briefed", async () => withPrivateDirectory(async (directory) => {
  const { calls, call } = server({ continuity: false, checkpoint: { title: "Task", content: "Progress" } });
  const run = runner(directory, call, { host: "t3", id: "thread-A" });
  const start = await run("SessionStart");
  assert.equal(sessionCalls(calls).length, 0, "no briefing read on an older server");
  assert.doesNotMatch(String(start.context), /Resuming checkpoint/);
  assert.doesNotMatch(String(start.context), /joins/);
  await run("UserPromptSubmit", { turn_id: "t1" });
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Task", content: "Progress" } } });
  await run("Checkpoint");
  assert.ok(sessionCalls(calls).length >= 2);
  assert.equal(sessionCalls(calls).some(({ args }) => "thread_key" in args), false);
}));

test("a start resumes the thread's checkpoint with bounded content ahead of Agent Now, and the instructions name it", async () => withPrivateDirectory(async (directory) => {
  const content = `Objective: ship continuity\n${"detail ".repeat(800)}TAIL-MARKER`;
  const { call } = server({ checkpoint: { title: "Continuity", content } });
  const start = String((await runner(directory, call, { host: "t3", id: "thread-A" })("SessionStart")).context);
  const resume = start.indexOf("Resuming checkpoint [[Continuity]]");
  assert.ok(resume >= 0);
  assert.ok(resume < start.indexOf("Agent Now"), "the resumed checkpoint leads the briefing");
  assert.match(start, /Objective: ship continuity/);
  assert.equal(start.includes("TAIL-MARKER"), false, "long content is cut");
  assert.ok(start.slice(resume, start.indexOf("Agent Now")).length < 1800, "about 1,500 characters of content");
  assert.match(start, /Automatic memory: .*\[\[Continuity\]\]/);
  assert.ok(start.length < 3200, "briefing plus instructions stay small");
}));

test("without a linked checkpoint the instructions say a save creates or joins one by title, and a first prompt also briefs", async () => withPrivateDirectory(async (directory) => {
  const { calls, call } = server();
  const prompt = String((await runner(directory, call, { host: "t3", id: "thread-A" })("UserPromptSubmit", { turn_id: "t1", prompt: "hi" })).context);
  assert.equal(sessionCalls(calls).filter(({ args }) => args.action === "read").length, 1, "the first prompt reads the resolved checkpoint");
  assert.doesNotMatch(prompt, /Resuming checkpoint/);
  assert.match(prompt, /creates .*joins .*title/);
  assert.match(prompt, /"continue"/, "continue guidance stays");
  assert.match(prompt, /finish/, "finish guidance stays");
}));

test("a model switch is a new session in the same thread and resumes the same checkpoint", async () => withPrivateDirectory(async (directory) => {
  const { calls, call } = server({ checkpoint: { title: "Shared work", content: "Claude progress" } });
  const thread = { host: "t3", id: "thread-A" };
  await runner(directory, call, thread, "claude", "claude-session")("SessionStart");
  const codex = String((await runner(directory, call, thread, "codex", "codex-session")("SessionStart")).context);
  assert.match(codex, /Resuming checkpoint \[\[Shared work\]\]/);
  const [first, second] = sessionCalls(calls);
  assert.equal(first.args.thread_key, second.args.thread_key);
  assert.deepEqual([first.args.session_id, second.args.session_id], ["claude-session", "codex-session"]);
}));

test("a save that joined a workstream is reported to the agent with the resolved title", async () => withPrivateDirectory(async (directory) => {
  const { call } = server({ save: (args) => ({ saved: true, request_id: args.request_id, note_id: "note-9", revision: hex("d"), closed: false, joined: true, title: "Shared work" }) });
  const run = runner(directory, call, { host: "t3", id: "thread-A" });
  await run("UserPromptSubmit", { turn_id: "t1" });
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "shared WORK", content: "Mine" }, expected_revision: hex("d") } });
  const flushed = await run("Checkpoint");
  assert.equal((flushed.receipt as { joined: boolean }).joined, true);
  const next = String((await run("SessionStart")).context);
  assert.match(next, /joined .*\[\[Shared work\]\]/);
}));

test("a workstream conflict tells the agent to read that checkpoint, merge, and restage with its revision", async () => withPrivateDirectory(async (directory) => {
  let joined = false;
  const { call } = server({ save: (args) => {
    if (args.expected_revision !== hex("e")) throw new MemoryClientError(conflictMessage(`Checkpoint [[Shared work]] already holds this workstream at revision ${hex("e")}; read that note`), { category: "conflict", phase: "call", ...workstreamConflict(`Checkpoint [[Shared work]] already holds this workstream at revision ${hex("e")}; read that note`) });
    joined = true;
    return { saved: true, request_id: args.request_id, note_id: "note-9", revision: hex("f"), closed: false, joined: true, title: "Shared work" };
  } });
  const run = runner(directory, call, { host: "t3", id: "thread-A" });
  await run("UserPromptSubmit", { turn_id: "t1" });
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Shared work", content: "Mine" } } });
  const failed = await run("Checkpoint");
  const pending = failed.pending_request as { request_id: string; recovery: string };
  assert.match(pending.recovery, /\[\[Shared work\]\]/);
  assert.match(pending.recovery, new RegExp(`"expected_revision": "${hex("e")}"`));
  assert.match(pending.recovery, new RegExp(`"replaces_request_id": "${pending.request_id}"`));
  assert.match(String(failed.warning), /\[\[Shared work\]\]/);
  assert.match(String((await run("SessionStart")).context), /\[\[Shared work\]\].*e{64}/, "the stale-conflict notice keeps the target");
  await run("Checkpoint", {}, { stage: { checkpoint: { title: "Shared work", content: "Theirs + mine" }, expected_revision: hex("e"), replaces_request_id: pending.request_id } });
  assert.equal((await run("Checkpoint")).saved, true);
  assert.equal(joined, true);
}));

test("workstream conflict details keep only a valid title and revision", () => {
  const detail = `Checkpoint [[Shared work]] already holds this workstream at revision ${hex("a")}; SECRET`;
  assert.deepEqual(workstreamConflict(detail), { workstream: { title: "Shared work", revision: hex("a") } });
  assert.match(conflictMessage(detail), /\[\[Shared work\]\]/);
  assert.equal(conflictMessage(detail).includes("SECRET"), false);
  assert.deepEqual(workstreamConflict(`Session memory is at revision ${hex("a")}`), {});
});
