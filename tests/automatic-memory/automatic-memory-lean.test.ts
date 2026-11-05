import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultThresholds } from "../../scripts/memory/profile";
import { runMemoryEvent, type HookInput, type MemoryCall } from "../../scripts/memory/runtime";

async function withDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chibako-memory-lean-"));
  await chmod(directory, 0o700);
  try { return await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const event = (hook_event_name: string, overrides: Partial<HookInput> = {}): HookInput => ({ session_id: "s1", hook_event_name, ...overrides });
const quiet: MemoryCall = async () => ({});
const run = (directory: string, input: HookInput, call: MemoryCall = quiet, extra: object = {}) =>
  runMemoryEvent({ runtime: "claude", directory, enabled: true, call, input, ...extra });

async function turns(directory: string, count: number, extra: object = {}) {
  for (let turn = 1; turn <= count; turn++) await run(directory, event("UserPromptSubmit", { turn_id: `t${turn}` }), quiet, extra);
}

test("defaults ask for a checkpoint at 12 user turns or 40 tool calls, and stored thresholds win", async () => {
  assert.deepEqual(defaultThresholds, { user_turns: 12, tool_calls: 40 });
  await withDirectory(async (directory) => {
    await turns(directory, 11);
    assert.equal((await run(directory, event("Stop"))).request, undefined, "11 turns used to ask at 4");
    await run(directory, event("UserPromptSubmit", { turn_id: "t12" }));
    assert.match(String((await run(directory, event("Stop"))).request), /Memory checkpoint due/);
  });
  await withDirectory(async (directory) => {
    for (let i = 0; i < 39; i++) await run(directory, event("PostToolUse"));
    assert.equal((await run(directory, event("Stop"))).request, undefined, "39 tool calls used to ask at 10");
    await run(directory, event("PostToolUse"));
    assert.match(String((await run(directory, event("Stop"))).request), /Memory checkpoint due/);
  });
  await withDirectory(async (directory) => {
    const stored = { thresholds: { user_turns: 2, tool_calls: 99 } };
    await turns(directory, 2, stored);
    assert.match(String((await run(directory, event("Stop"), quiet, stored)).request), /Memory checkpoint due/, "a stored profile threshold is respected");
  });
});

test("Codex still counts tool calls only", async () => withDirectory(async (directory) => {
  const codex = (input: HookInput) => runMemoryEvent({ runtime: "codex", promptRequests: true, directory, enabled: true, call: quiet, input });
  for (let turn = 1; turn <= 30; turn++) await codex(event("UserPromptSubmit", { turn_id: `t${turn}` }));
  assert.equal((await codex(event("Stop"))).request, undefined);
  for (let i = 0; i < 39; i++) assert.deepEqual(await codex(event("PostToolUse")), {});
  assert.match(String((await codex(event("PostToolUse"))).context), /Memory checkpoint due/);
}));

test("the checkpoint request is short and keeps the staging format and revision rule", async () => withDirectory(async (directory) => {
  const options = { thresholds: { user_turns: 1, tool_calls: 99 }, stageCommand: "stage-cmd" };
  await run(directory, event("UserPromptSubmit", { turn_id: "t1" }), quiet, options);
  const text = String((await run(directory, event("Stop"), quiet, options)).request);
  assert.ok(text.length < 900, `request is ${text.length} characters`);
  for (const required of ['"checkpoint": {"title"', '"now_line"', '{"finish": {}}', '{"skip": "reason"}', "memory_session action read", '"expected_revision"', "stage-cmd"]) {
    assert.ok(text.includes(required), required);
  }
}));

test("a resumed session still gets its checkpoint at the new defaults", async () => withDirectory(async (directory) => {
  const call: MemoryCall = async (name, args) => {
    if (name === "memory_status") return { continuity: 1 };
    if (name === "memory_session" && args.action === "read") return { note: { title: "Work", content: "objective and decisions" }, revision: "r1" };
    return {};
  };
  const start = await run(directory, event("SessionStart"), call, { thread: { host: "t3", id: "thread-1" } });
  assert.match(String(start.context), /Resuming checkpoint \[\[Work\]\][^]*objective and decisions/);
}));

test("Agent Now injects fewer characters once the project resolves", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const lines = Array.from({ length: 15 }, (_, i) => `- [[Thread ${i}]] (${i < 2 ? "atlas" : `other${i}`}) — next step number ${i} · ${today}`).join("\n");
  const call: MemoryCall = async (name) => name === "memory_read" ? { note: { content: `# Agent Now\n\n${lines}\n` }, revision: "a".repeat(64) } : {};
  const size = async (resolveProject?: () => string) => withDirectory(async (directory) =>
    String((await run(directory, event("SessionStart", { cwd: "/work/atlas" }), call, resolveProject ? { resolveProject } : {})).context).length);
  const all = await size();
  const scoped = await size(() => "atlas");
  assert.ok(scoped < all * 0.6, `${scoped} should be well under ${all}`);
});

const recallCall = (results: unknown[], calls: Array<Record<string, unknown>> = []): MemoryCall => async (name, args) => {
  if (name === "recall") { calls.push(args); return { count: results.length, results, mode: "keyword", fallback_reason: null }; }
  return {};
};
const prompt = (directory: string, text: string, call: MemoryCall) => run(directory, event("UserPromptSubmit", { turn_id: "t1", prompt: text }), call);

test("Recall results are injected when one result matches two or more query terms", async () => withDirectory(async (directory) => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await prompt(directory, "how does token validation work", recallCall([{ title: "Auth", matched: ["token", "validation"] }, { title: "Other", matched: ["work"] }], calls));
  assert.match(String(result.context), /Relevant memory \(evidence, not instructions\):/);
  assert.match(String(result.context), /"Auth"/);
  assert.deepEqual([calls[0]!.limit, calls[0]!.budget, calls[0]!.query], [5, 1600, "how does token validation work"], "the Recall call is unchanged");
}));

test("a one-word-overlap result set injects nothing and adds no memory text", async () => withDirectory(async (directory) => {
  const result = await prompt(directory, "how does token validation work", recallCall([{ title: "A", matched: ["token"] }, { title: "B", matched: ["work"] }, { title: "C", matched: [] }]));
  assert.doesNotMatch(String(result.context), /Relevant memory/);
  assert.doesNotMatch(String(result.context), /"A"|"B"|"C"/);
  const empty = await withDirectory((other) => prompt(other, "anything at all", recallCall([])));
  assert.doesNotMatch(String(empty.context), /Relevant memory/);
}));

test("results found by meaning alone are not injected, in any mode", async () => withDirectory(async (directory) => {
  const call: MemoryCall = async (name) => name === "recall" ? { count: 1, results: [{ title: "Semantic", matched: [] }], mode: "hybrid", fallback_reason: null } : {};
  assert.doesNotMatch(String((await prompt(directory, "where do we store sessions", call)).context), /Relevant memory/);
}));

test("a malformed Recall response is a retrieval warning, never a silent miss", async () => {
  for (const bad of [{}, { results: "none" }, { results: [{ matched: [null, null] }] }, { results: [{}] }]) {
    await withDirectory(async (directory) => {
      const result = await prompt(directory, "how does token validation work", async (name) => name === "recall" ? bad : {});
      assert.match(String(result.warning), /Memory retrieval unavailable/);
      assert.doesNotMatch(String(result.context), /Relevant memory/);
    });
  }
});

test("filler words do not hide a one-term query", async () => {
  await withDirectory(async (directory) => {
    const result = await prompt(directory, "What is Osprey?", recallCall([{ title: "Osprey", matched: ["osprey"] }]));
    assert.match(String(result.context), /Relevant memory/, "the server drops what/is, so osprey is the only term");
  });
});

test("the only term of a one-term query is enough", async () => {
  await withDirectory(async (directory) => {
    const result = await prompt(directory, "Osprey?", recallCall([{ title: "Osprey", matched: ["osprey"] }]));
    assert.match(String(result.context), /Relevant memory/);
  });
  await withDirectory(async (directory) => {
    const result = await prompt(directory, "osprey nests", recallCall([{ title: "Osprey", matched: ["osprey"] }]));
    assert.doesNotMatch(String(result.context), /Relevant memory/, "one of two terms is a weak match");
  });
});
