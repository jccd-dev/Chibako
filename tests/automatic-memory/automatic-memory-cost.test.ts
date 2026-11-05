import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { localStatus, saveProfile, type MemoryProfile } from "../../scripts/memory/profile";
import { runMemoryEvent, type HookInput, type MemoryCall } from "../../scripts/memory/runtime";

async function withProfile<T>(run: (profile: string, state: string) => Promise<T>): Promise<T> {
  const profile = await mkdtemp(join(tmpdir(), "chibako-memory-cost-"));
  await chmod(profile, 0o700);
  const state = join(profile, "state");
  await mkdir(state, { mode: 0o700 });
  try { return await run(profile, state); }
  finally { await rm(profile, { recursive: true, force: true }); }
}
const profileFile: MemoryProfile = { version: 1, runtime: "claude", name: "t", endpoint: "http://x", api_key: "k", principal_id: "p", area: "a", enabled: true, connected_at: "now", host: { file: "/h", digest: "d" } };
const event = (hook_event_name: string, overrides: Partial<HookInput> = {}): HookInput => ({ session_id: "s1", hook_event_name, ...overrides });
const SECRET = "SECRET-NOTE-BODY";
const call: MemoryCall = async (name, args) => {
  if (name === "memory_status") return { continuity: 1 };
  if (name === "memory_session" && args.action === "read") return { note: { title: "Work", content: `resume ${SECRET}` }, revision: "r1" };
  if (name === "memory_read") return { note: { content: `- [[Work]] — next ${SECRET}` } };
  if (name === "recall") return { results: [{ title: SECRET, matched: ["question", "work"] }] };
  if (name === "memory_session" && args.action === "activity") return { saved: true, request_id: args.request_id, note_id: "n", revision: "a".repeat(64) };
  return {};
};
// The session's counters as the status path reports them (profile is the parent of the state directory).
const stats = async (state: string, index = 0) => {
  await saveProfile(dirname(state), profileFile);
  return (await localStatus(dirname(state)) as { cost: { sessions: Array<Record<string, unknown>> } }).cost.sessions[index]!;
};
const runIn = (state: string, thresholds = { user_turns: 99, tool_calls: 99 }) => (input: HookInput) => runMemoryEvent({ runtime: "claude", directory: state, enabled: true, call, thresholds, thread: { host: "t3", id: "thread-1" }, input });

test("counters record chars injected by source and checkpoint requests, without content", async () => withProfile(async (_profile, state) => {
  const run = runIn(state, { user_turns: 1, tool_calls: 99 });
  const first = await run(event("UserPromptSubmit", { turn_id: "t1", prompt: "question" }));
  const injected = (await stats(state)).injected as Record<string, number>;
  assert.ok(injected.resume > 0 && injected.now > 0 && injected.recall > 0 && injected.instructions > 0);
  assert.equal(injected.resume + injected.now + injected.recall + injected.instructions, (first.context ?? "").length);
  assert.equal((await run(event("Stop"))).request !== undefined, true);
  const final = await stats(state);
  assert.equal(final.checkpoint_requests, 1);
  assert.equal(final.captures, 0);
  // Counters hold numbers only; a state file never gains note text through them.
  const files = await readdir(state);
  assert.equal((await readFile(join(state, files.find((f) => f.endsWith(".json"))!), "utf8")).includes(SECRET), false);
}));

test("a capture is counted once it is verified", async () => withProfile(async (profile, state) => {
  const run = runIn(state);
  for (let i = 0; i < 3; i++) await run(event("PostToolUse"));
  await run(event("SessionEnd", { cwd: profile }));
  assert.equal((await stats(state)).captures, 1);
}));

test("status surfaces totals and per-session counters", async () => withProfile(async (profile, state) => {
  await saveProfile(profile, profileFile);
  const run = runIn(state);
  await run(event("UserPromptSubmit", { turn_id: "t1", prompt: "q" }));
  await run(event("UserPromptSubmit", { session_id: "s2", turn_id: "t1", prompt: "q" }));
  const status = await localStatus(profile) as { cost: { sessions: Array<{ injected: Record<string, number> }>; totals: { injected: Record<string, number> } } };
  assert.equal(status.cost.sessions.length, 2);
  assert.equal(status.cost.totals.injected.recall, status.cost.sessions[0]!.injected.recall * 2);
  assert.equal(JSON.stringify(status).includes(SECRET), false);
}));

test("a malformed counter block never breaks a hook or status", async () => withProfile(async (profile, state) => {
  const run = runIn(state);
  await run(event("PostToolUse"));
  const file = join(state, (await readdir(state)).find((f) => f.endsWith(".json"))!);
  const saved = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...saved, stats: { injected: "garbage", captures: -4 } }), { mode: 0o600 });
  assert.deepEqual(await run(event("PostToolUse")), {});
  assert.deepEqual((await stats(state)).injected, { resume: 0, now: 0, recall: 0, instructions: 0 });
  await saveProfile(profile, profileFile);
  await writeFile(file, JSON.stringify({ ...saved, stats: "nope" }), { mode: 0o600 });
  assert.ok("cost" in (await localStatus(profile)));
}));
