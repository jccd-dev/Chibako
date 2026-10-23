import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type MemoryCall, type Runtime } from "../../scripts/memory/runtime";

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
