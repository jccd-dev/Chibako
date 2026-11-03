import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type HookInput, type MemoryCall, type Runtime } from "../../scripts/memory/runtime";
import { MemoryClientError } from "../../scripts/memory/client-error";
import { claude } from "../../scripts/memory/claude/adapter";

type Calls = Array<{ name: string; args: Record<string, unknown> }>;
async function withPrivateDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chibako-memory-activity-"));
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const receipts: MemoryCall = async (name, args) => name === "memory_session" && args.action !== "read"
  ? { saved: true, request_id: args.request_id, note_id: "note-1", revision: "a".repeat(64), closed: args.action === "finish" } : {};
function harness(directory: string, runtime: Runtime, response: MemoryCall = receipts, cwd?: string) {
  const calls: Calls = [];
  const call: MemoryCall = async (name, args) => { calls.push({ name, args }); return response(name, args); };
  const promptRequests = runtime !== "claude";
  const run = (hook_event_name: string, overrides: Partial<HookInput> = {}, stage?: unknown) =>
    runMemoryEvent({ runtime, directory, enabled: true, call, promptRequests, input: { session_id: "s1", hook_event_name, ...(cwd ? { cwd } : {}), ...overrides }, ...(stage ? { stage } : {}) });
  const tools = async (count: number) => { for (let i = 0; i < count; i++) await run("PostToolUse"); };
  const activity = () => calls.filter(({ name, args }) => name === "memory_session" && args.action === "activity");
  return { calls, run, tools, activity };
}

test("Codex Stop captures activity once above the fallback threshold, then counters reset", async () => withPrivateDirectory(async (directory) => {
  const h = harness(directory, "codex");
  await h.run("UserPromptSubmit", { turn_id: "t1" });
  await h.tools(2);
  assert.deepEqual(await h.run("Stop"), {});
  assert.equal(h.activity().length, 0, "two tool calls are trivial");
  await h.tools(1);
  assert.deepEqual(await h.run("Stop"), {});
  assert.equal(h.activity().length, 1);
  const args = h.activity()[0].args;
  assert.equal(args.runtime, "codex");
  assert.equal(args.session_id, "s1");
  assert.match(String(args.request_id), /^activity-[a-f0-9]{32}$/);
  assert.deepEqual(args.entry, { files: [], files_changed: 0, tool_calls: 3, user_turns: 1 }, "outside git only counts are sent");
  await h.run("Stop");
  assert.equal(h.activity().length, 1, "one capture per unit of work");
  await h.tools(3);
  await h.run("Stop");
  assert.equal(h.activity().length, 2);
  assert.equal((h.activity()[1].args.entry as { tool_calls: number }).tool_calls, 3, "counted since the last capture");
}));

test("Hermes Stop captures too, unless it is asking the agent to save", async () => withPrivateDirectory(async (directory) => {
  const h = harness(directory, "hermes");
  await h.tools(4);
  await h.run("Stop");
  assert.equal(h.activity().length, 1);
  await h.tools(10);
  assert.match(String((await h.run("Stop")).request), /Memory checkpoint due/);
  assert.equal(h.activity().length, 1, "a checkpoint request leaves the unit of work to the agent");
}));

test("Claude Stop and SessionEnd capture; SessionEnd flushes pending work and never finishes", async () => withPrivateDirectory(async (directory) => {
  const h = harness(directory, "claude");
  await h.run("UserPromptSubmit", { turn_id: "t1" });
  await h.tools(3);
  await h.run("Stop");
  assert.equal(h.activity().length, 1);
  await h.tools(5);
  assert.deepEqual(claude.hookInput({ session_id: "s1", hook_event_name: "SessionEnd" }).hook_event_name, "SessionEnd");
  assert.deepEqual(await h.run("SessionEnd"), {});
  assert.equal(h.activity().length, 2);

  // A staged checkpoint is flushed at SessionEnd, and the save counts as the unit of work.
  await h.tools(5);
  await h.run("Checkpoint", {}, { checkpoint: { title: "Work", content: "Body" }, now_line: "Next", expected_revision: null });
  const before = h.calls.length;
  await h.run("SessionEnd");
  assert.deepEqual(h.calls.slice(before).map(({ args }) => args.action), ["save"]);
  assert.equal(h.calls.some(({ args }) => args.action === "finish"), false, "a session ending is not the task ending");
}));

test("no capture after a save, skip or finish, or while work is pending", async () => withPrivateDirectory(async (directory) => {
  const h = harness(directory, "codex", async (name, args) => args.action === "save" ? { saved: false } : receipts(name, args));
  await h.run("UserPromptSubmit", { turn_id: "t1" });
  await h.tools(5);
  await h.run("Checkpoint", {}, { skip: "Nothing durable" });
  await h.run("Stop");
  assert.equal(h.activity().length, 0, "skip");
  await h.tools(5);
  await h.run("Checkpoint", {}, { checkpoint: { title: "Work", content: "Body" }, now_line: "Next", expected_revision: null });
  await h.run("Stop");
  assert.equal(h.activity().length, 0, "pending (unverified save stays pending)");
}));

test("finish resets the activity count", async () => withPrivateDirectory(async (directory) => {
  const h = harness(directory, "codex");
  await h.run("UserPromptSubmit", { turn_id: "t1" });
  await h.tools(5);
  await h.run("Checkpoint", {}, { finish: {}, expected_revision: null });
  await h.run("Stop");
  assert.equal(h.activity().length, 0);
}));

test("capture failures warn once and never block; an older server is skipped silently", async () => withPrivateDirectory(async (directory) => {
  const failing = harness(join(directory, "a"), "codex", async (name, args) => {
    if (args.action === "activity") throw new MemoryClientError("Memory request failed (timeout)", { category: "timeout", phase: "call" });
    return receipts(name, args);
  });
  await failing.tools(3);
  const first = await failing.run("Stop");
  assert.match(String(first.warning), /activity/i);
  assert.equal(first.request, undefined);
  await failing.tools(3);
  assert.deepEqual(await failing.run("Stop"), {}, "warned once per session");
  assert.equal(failing.activity().length, 2);

  const older = harness(join(directory, "b"), "codex", async (name, args) => {
    if (args.action === "activity") throw new MemoryClientError("Server lacks continuity", { category: "unsupported", phase: "connect" });
    return receipts(name, args);
  });
  await older.tools(3);
  assert.deepEqual(await older.run("Stop"), {});
}));

test("inside git, the entry carries branch, short head and up to 10 repo-relative changed files", async () => withPrivateDirectory(async (directory) => {
  const repo = join(directory, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "feat/capture");
  await writeFile(join(repo, "README.md"), "x");
  git("add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
  for (let i = 0; i < 12; i++) await writeFile(join(repo, "src", `f${i}.ts`), "x");
  await writeFile(join(repo, "README.md"), "changed");
  const h = harness(join(directory, "state"), "codex", receipts, join(repo, "src"));
  await h.tools(3);
  await h.run("Stop");
  const entry = h.activity()[0].args.entry as { branch: string; head: string; files: string[]; files_changed: number };
  assert.equal(entry.branch, "feat/capture");
  assert.match(entry.head, /^[a-f0-9]{7,40}$/);
  assert.equal(entry.files.length, 10);
  assert.equal(entry.files_changed, 13);
  assert.ok(entry.files.includes("README.md") || entry.files.every((file) => file.startsWith("src/")), "paths are relative to the repository root");
  assert.ok(entry.files.every((file) => !file.startsWith("/")));
}));
