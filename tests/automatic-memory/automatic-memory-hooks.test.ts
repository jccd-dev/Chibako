import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type MemoryCall, type Runtime } from "../../scripts/memory/runtime";
import { codex } from "../../scripts/memory/codex/adapter";

// Codex event contracts: https://learn.chatgpt.com/docs/hooks#event-reference
// Wire schemas: openai/codex e75e4af22938c8715b2a1e0d3fc142836ab4d962, codex-rs/hooks/schema/generated.
test("Codex encodes context, continuation and warnings only on events that accept them", () => {
  for (const hook_event_name of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PreCompact", "Interrupt"]) {
    const input = codex.hookInput({ session_id: "codex-session", hook_event_name, cwd: "/fixture", turn_id: "turn-1" });
    const output = codex.hookOutput(input, { context: "briefing", request: "checkpoint", warning: "warning", saved: true });
    assert.deepEqual(output, {
      ...(["SessionStart", "UserPromptSubmit", "PostToolUse"].includes(hook_event_name)
        ? { hookSpecificOutput: { hookEventName: hook_event_name, additionalContext: "briefing" } } : {}),
      systemMessage: "warning",
    }, hook_event_name);
  }
  assert.deepEqual(codex.hookFailure("failure"), { systemMessage: "failure" });
});

test("Codex accepts its native payload fields and rejects malformed engine input", () => {
  const common = { session_id: "codex-session", cwd: "/fixture", model: "fixture-model", transcript_path: null };
  const turn = { ...common, turn_id: "turn-1", permission_mode: "dontAsk" };
  const events = [
    { ...common, permission_mode: "dontAsk", hook_event_name: "SessionStart", source: "compact" },
    { ...turn, hook_event_name: "UserPromptSubmit", prompt: "Inspect hooks" },
    { ...turn, hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "call-1", tool_input: { command: "true" }, tool_response: { exit_code: 0 } },
    { ...turn, hook_event_name: "Stop", stop_hook_active: true, last_assistant_message: null },
    { ...common, turn_id: "turn-1", hook_event_name: "PreCompact", trigger: "auto" },
    { ...turn, hook_event_name: "Interrupt" },
  ];
  for (const event of events) {
    const input = codex.hookInput(event);
    assert.equal(input.session_id, common.session_id);
    assert.equal(input.hook_event_name, event.hook_event_name);
    assert.equal("transcript_path" in input, false, "unused transcript paths never reach the memory engine");
  }
  assert.equal(codex.hookInput(events[1]).turn_id, "turn-1");
  assert.equal(codex.hookInput(events[1]).prompt, "Inspect hooks");
  assert.equal(codex.hookInput(events[3]).stop_hook_active, true);
  for (const invalid of [{ ...turn, hook_event_name: "Checkpoint" }, { ...events[1], prompt: 42 }, { ...events[3], stop_hook_active: "true" }, { ...events[1], session_id: "" }]) {
    assert.throws(() => codex.hookInput(invalid));
  }
});

async function withPrivateDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chibako-memory-hooks-"));
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function child(args: string[], input: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const processChild = spawn(process.execPath, ["--import", "tsx", ...args], { cwd: process.cwd(), env, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  processChild.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  processChild.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const timer = setTimeout(() => processChild.kill("SIGKILL"), 15_000);
  try {
    const code = await new Promise<number | null>((resolveCode, reject) => {
      processChild.once("error", reject);
      processChild.once("close", resolveCode);
      processChild.stdin.end(input);
    });
    return { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
  } finally { clearTimeout(timer); }
}

function env(directory: string, enabled: boolean): NodeJS.ProcessEnv {
  return { ...process.env, CHIBAKO_MEMORY_ENABLED: enabled ? "1" : "0", CHIBAKO_MEMORY_STATE_DIR: directory, CHIBAKO_MEMORY_MCP_URL: "", CHIBAKO_MEMORY_API_KEY: "", CODEX_HOME: join(directory, "codex-home"), CLAUDE_CONFIG_DIR: join(directory, "claude-home"), HERMES_HOME: join(directory, "hermes-home") };
}
function checkpoint(session_id: string, request_id = `request-${session_id}`) {
  return { request_id, role: "session", subject: "topic", session_id, title: "Hook checkpoint", content: "Local staged content", expected_revision: null };
}
async function prepopulate(runtime: Runtime, directory: string, session_id: string): Promise<void> {
  const call: MemoryCall = async () => ({});
  await runMemoryEvent({ runtime, directory, enabled: true, call, input: { session_id, hook_event_name: "UserPromptSubmit", turn_id: `turn-${session_id}` } });
}
async function states(directory: string): Promise<Array<Record<string, unknown>>> {
  const files = await readdir(directory);
  return Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8"))));
}

test("Codex and Claude CLI stage checkpoints and skips locally; paused hooks create no state", async () => withPrivateDirectory(async (directory) => {
  for (const runtime of ["codex", "claude"] as const) {
    const checkpointSession = `${runtime}-checkpoint`;
    await prepopulate(runtime, directory, checkpointSession);
    const saved = checkpoint(checkpointSession);
    const stageResult = await child(["scripts/agent-memory.ts", runtime, "stage"], JSON.stringify({ session_id: checkpointSession, hook_event_name: "Checkpoint", checkpoint: saved }), env(directory, true));
    assert.equal(stageResult.code, 0, stageResult.stderr);
    const stageOutput = JSON.parse(stageResult.stdout);
    assert.equal(stageOutput.staged, true);
    assert.equal(stageOutput.pending, true, "without an endpoint, the staged checkpoint remains private and pending");
    assert.match(stageOutput.systemMessage, /UNSAVED/);
    assert.equal(stageResult.stderr.includes("calls=0"), true, "empty endpoint fails before any transport request");
    assert.ok((await states(directory)).some((state) => (state.pending as { checkpoint?: { request_id?: string } })?.checkpoint?.request_id === saved.request_id));

    const skipSession = `${runtime}-skip`;
    await prepopulate(runtime, directory, skipSession);
    const skipResult = await child(["scripts/agent-memory.ts", runtime, "stage"], JSON.stringify({ session_id: skipSession, hook_event_name: "Checkpoint", skip: "No durable changes" }), env(directory, true));
    assert.equal(skipResult.code, 0, skipResult.stderr);
    assert.deepEqual(JSON.parse(skipResult.stdout), { staged: false, skipped: true });
    assert.ok((await states(directory)).some((state) => state.acknowledged === `turn-${skipSession}`));

    const pausedDir = join(directory, `${runtime}-paused`);
    const paused = await child(["scripts/agent-memory.ts", runtime], "not-json", env(pausedDir, false));
    assert.equal(paused.code, 0);
    assert.equal(paused.stdout.trim(), "{}");
    await assert.rejects(() => readdir(pausedDir), { code: "ENOENT" });
  }
}));

test("Hermes envelopes map pre_llm_call context and pre_verify continuation once", async () => withPrivateDirectory(async (directory) => {
  const session_id = "hermes-session";
  await prepopulate("hermes", directory, session_id);
  const hook = resolve("integrations/agent-memory/hermes-hook.ts");
  const hermesEnv = env(directory, true);
  const prompt = await child([hook], JSON.stringify({
    hook_event_name: "pre_llm_call", session_id,
    extra: { user_message: "Inspect the open checkpoint", turn_id: "hermes-turn-9" },
  }), hermesEnv);
  assert.equal(prompt.code, 0, prompt.stderr);
  const context = JSON.parse(prompt.stdout).context as string;
  assert.match(context, /Memory retrieval unavailable/,
    "with Now preloaded and no endpoint, retrieval failure shows extra.user_message triggered recall");

  const verifyInput = JSON.stringify({ hook_event_name: "pre_verify", session_id });
  const trivial = await child([hook], verifyInput, hermesEnv);
  assert.equal(trivial.code, 0, trivial.stderr);
  assert.equal(trivial.stdout.trim(), "", "a trivial turn gets no continuation");
  for (let i = 0; i < 10; i++) {
    const counted = await child([hook], JSON.stringify({ hook_event_name: "post_tool_call", session_id }), hermesEnv);
    assert.equal(counted.code, 0, counted.stderr);
  }

  const first = await child([hook], verifyInput, hermesEnv);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).action, "continue");
  assert.match(JSON.parse(first.stdout).message, /Memory checkpoint due/);
  const repeated = await child([hook], verifyInput, hermesEnv);
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.equal(repeated.stdout.trim(), "", "the same turn cannot request continuation twice");
}));

test("stage --session fills the hook identity; a malformed payload names the bad field, not the content", async () => withPrivateDirectory(async (directory) => {
  const session_id = "claude-session-flag";
  await prepopulate("claude", directory, session_id);
  const run = (payload: unknown) => child(["scripts/agent-memory.ts", "claude", "stage", "--session", session_id], JSON.stringify(payload), env(directory, true));
  const bad = await run({ checkpoint: { role: "overview", subject: "topic", title: "x".repeat(121), content: "SECRET-CONTENT" } });
  assert.equal(bad.code, 1);
  const message = JSON.parse(bad.stdout).systemMessage as string;
  assert.match(message, /^Invalid memory payload: .*checkpoint\.title/);
  assert.equal(message.includes("SECRET-CONTENT"), false);

  // The empty-endpoint test connection cannot read, so supply the revision to isolate session defaults.
  const good = await run({ checkpoint: { role: "overview", subject: "topic", title: "Flagged", content: "Local staged content", expected_revision: null } });
  assert.equal(good.code, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).staged, true);
  const pending = (await states(directory)).map((state) => (state.pending as { checkpoint?: { session_id?: string } } | undefined)?.checkpoint?.session_id);
  assert.ok(pending.includes(session_id));
}));


test("Codex keeps trivial chats silent and delivers one work reminder as developer context", async () => withPrivateDirectory(async (directory) => {
  const run = (hook_event_name: string, turn_id = "t1") => runMemoryEvent({
    runtime: "codex", promptRequests: codex.promptRequests, directory, enabled: true,
    call: async () => ({}), input: { session_id: "quiet-chat", hook_event_name, turn_id, prompt: "Thanks" },
  });
  for (let turn = 1; turn <= 6; turn++) {
    assert.doesNotMatch(String((await run("UserPromptSubmit", `t${turn}`)).context), /Memory checkpoint due/);
    assert.deepEqual(codex.hookOutput({ session_id: "quiet-chat", hook_event_name: "Stop" }, await run("Stop")), {});
  }
  // A couple of turns and a few tools remain below both activity limits.
  await runMemoryEvent({ runtime: "codex", promptRequests: true, directory, enabled: true, call: async () => ({}),
    input: { session_id: "quiet-chat", hook_event_name: "Checkpoint" }, stage: { skip: "New task" } });
  await run("UserPromptSubmit", "work-1");
  for (let tool = 1; tool < 10; tool++) assert.deepEqual(await run("PostToolUse"), {});
  const result = await run("PostToolUse");
  assert.match(String(result.context), /Memory checkpoint due/);
  assert.deepEqual(codex.hookOutput({ session_id: "quiet-chat", hook_event_name: "PostToolUse" }, result), {
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: result.context },
  });
  assert.deepEqual(await run("PostToolUse"), {});
  assert.deepEqual(await run("Stop"), {});
  assert.doesNotMatch(String((await run("UserPromptSubmit", "work-2")).context), /Memory checkpoint due/);
}));
