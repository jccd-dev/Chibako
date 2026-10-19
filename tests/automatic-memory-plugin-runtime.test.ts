import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runMemoryEvent, type MemoryCall } from "../scripts/memory/runtime";

const binding = { endpoint: "https://vault.example/mcp", principal_id: "profile-a", area: "Agent Memory" };
function checkpoint() {
  return {
    request_id: randomUUID(), role: "session", subject: "setup", session_id: "session-1",
    title: "Pending checkpoint", content: "Keep this private until its original connection returns", expected_revision: null,
  };
}
const input = (hook_event_name: string) => ({ session_id: "session-1", hook_event_name, turn_id: "turn-1", prompt: "setup" });
function caller(calls: string[]): MemoryCall {
  return async (name) => { calls.push(name); return {}; };
}
async function withPrivateDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chibako-memory-binding-"));
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function state(directory: string): Promise<Record<string, unknown>> {
  const file = (await readdir(directory)).find((name) => name.endsWith(".json"));
  assert.ok(file, "runtime should retain its pending state file");
  return JSON.parse(await readFile(join(directory, file), "utf8"));
}

test("a pending checkpoint cannot flush under a changed endpoint, principal or memory area", async () => withPrivateDirectory(async (directory) => {
  const calls: string[] = [];
  const call = caller(calls);
  const pending = checkpoint();
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: input("UserPromptSubmit"), binding });
  await runMemoryEvent({ runtime: "codex", directory, enabled: true, call, input: input("PostToolUse"), binding, stage: { checkpoint: pending } });
  const initial = await state(directory);
  assert.deepEqual(initial.binding, binding);

  calls.length = 0;
  const changedBindings = [
    { ...binding, endpoint: "https://other.example/mcp" },
    { ...binding, principal_id: "profile-b" },
    { ...binding, area: "Other Area" },
  ];
  for (const changed of changedBindings) {
    await assert.rejects(() => runMemoryEvent({
      runtime: "codex", directory, enabled: true, call, input: input("Stop"), binding: changed,
    }), /belongs to another connection/);
    assert.deepEqual(await state(directory), initial, "a mismatched retry must leave the pending checkpoint unchanged");
  }
  assert.deepEqual(calls, [], "mismatched profiles must not call memory_write or retrieve data");
}));

test("an unbound legacy pending checkpoint is retained for owner review", async () => withPrivateDirectory(async (directory) => {
  const calls: string[] = [];
  const call = caller(calls);
  const pending = checkpoint();
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: input("UserPromptSubmit") });
  await runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input: input("PostToolUse"), stage: { checkpoint: pending } });
  const legacy = await state(directory);
  assert.equal(legacy.binding, undefined);

  calls.length = 0;
  await assert.rejects(() => runMemoryEvent({
    runtime: "claude", directory, enabled: true, call, input: input("Stop"), binding,
  }), /unbound or belongs to another connection/);
  assert.deepEqual(await state(directory), legacy);
  assert.deepEqual(calls, [], "legacy pending data is not sent to the new profile");
}));
