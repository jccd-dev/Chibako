import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { after, test, type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { POST as remote } from "../../src/app/mcp/route";
import { getDb } from "../../src/lib/db";
import { stripFrontmatter } from "../../src/lib/markdown";
import { sessionMemory } from "../../src/features/memory/session-memory";
import { deleteNote, getNote } from "../../src/lib/notes";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { saveProfile } from "../../scripts/memory/profile";
import { digest } from "../../scripts/memory/host-config";
import { atomicPrivateWrite, privateDirectory } from "../../scripts/memory/private-files";

const root = mkdtempSync(path.join(tmpdir(), "chibako-memory-bundle-transport-"));
process.env.CHIBAKO_DATA_DIR = path.join(root, "vault");
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory Test";
after(() => { getDb().close(); rmSync(root, { recursive: true, force: true }); });

type Rpc = { params?: { name?: string; arguments?: Record<string, unknown> } } | undefined;
type Relayed = { status: number; headers: Record<string, string>; body: Buffer };
let built: Promise<string> | undefined;
// Temporary packages from source; generated plugins/ and installed caches stay untouched.
const buildPackages = () => built ??= (async () => {
  const packages = path.join(root, "packages");
  const builder = pathToFileURL(path.join(process.cwd(), "scripts/build-memory-plugins.mjs")).href;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `const { buildMemoryPlugins } = await import(${JSON.stringify(builder)}); await buildMemoryPlugins(${JSON.stringify(packages)});`], { cwd: process.cwd() });
  return packages;
})();

// Loopback relay to the real /mcp route; `relay` may inject faults. Returning null drops the connection after the route answered.
async function startLoopback(t: TestContext, relay: (rpc: Rpc, forward: () => Promise<Relayed>) => Promise<Relayed | null>) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) {
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      const method = incoming.method || "POST";
      const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
      const listener = server.address();
      assert.ok(listener && typeof listener !== "string");
      const forward = async () => {
        const response = await remote(new Request(`http://127.0.0.1:${listener.port}${incoming.url || "/mcp"}`, { method, headers, ...(body ? { body } : {}) }));
        return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
      };
      const relayed = await relay(body ? JSON.parse(body.toString()) : undefined, forward);
      if (!relayed) { outgoing.destroy(); return; }
      outgoing.writeHead(relayed.status, relayed.headers);
      outgoing.end(relayed.body);
    } catch (error) {
      outgoing.writeHead(500, { "content-type": "text/plain" });
      outgoing.end(error instanceof Error ? error.message : "test transport failure");
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("sandbox denies binding a disposable loopback HTTP server (listen EPERM 127.0.0.1)");
      return null;
    }
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { endpoint: `http://127.0.0.1:${address.port}/mcp`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

// Each call is a fresh runner process, so private state must survive process boundaries.
function run(args: string[], input: object, env: NodeJS.ProcessEnv, allowFailure = false) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 15_000 }, (error, stdout, stderr) => {
      if (error && !allowFailure) reject(new Error(`runner ${args.slice(1).join(" ")} exited ${error.code ?? error.signal}: ${stdout}${stderr}`));
      else resolve({ stdout, stderr });
    });
    child.stdin?.end(JSON.stringify(input));
  });
}

test("compiled runner saves through authenticated MCP HTTP transport and acknowledges one retry-safe note", async (t) => {
  const packages = await buildPackages();
  const runner = path.join(packages, "codex", "bin", "memory.mjs");
  const key = createApiKey("Compiled memory runner", ["memory:write", "notes:read", "schema:read"]);
  const hostHome = path.join(root, "codex-home");
  const hostFile = path.join(hostHome, "config.toml");
  const profileDirectory = path.join(root, "private-profile");
  let advertiseLifecycle = true;
  let delaySaves = false;
  let saveCalls = 0;

  const loopback = await startLoopback(t, async (rpc, forward) => {
    const response = await forward();
    if (rpc?.params?.name === "memory_session" && rpc.params.arguments?.action !== "read") {
      saveCalls++;
      // The write has committed; only its response is late, so the client cannot know the outcome.
      if (delaySaves) await new Promise((resolve) => setTimeout(resolve, 5_500));
    }
    if (!advertiseLifecycle && rpc?.params?.name === "memory_status") {
      const payload = JSON.parse(response.body.toString());
      delete payload.result.structuredContent.session_lifecycle;
      response.body = Buffer.from(JSON.stringify(payload));
    }
    return response;
  });
  if (!loopback) return;
  const { endpoint } = loopback;

  try {
    await saveProfile(profileDirectory, {
      version: 1, runtime: "codex", name: "integration", endpoint, api_key: key.key,
      principal_id: key.id, area: "Agent Memory Test", enabled: true,
      connected_at: new Date().toISOString(), host: { file: hostFile, digest: digest("") },
    });
    const environment = {
      ...process.env,
      HOME: root,
      CODEX_HOME: hostHome,
      CHIBAKO_DATA_DIR: process.env.CHIBAKO_DATA_DIR,
      CHIBAKO_MEMORY_PROFILE_DIR: undefined,
    } satisfies NodeJS.ProcessEnv;
    const invoke = (input: object, action = "hook", extra: string[] = [], allowFailure = false) =>
      run([runner, "codex", action, "--profile-dir", profileDirectory, ...extra], input, environment, allowFailure);

    const prompt = { session_id: "bundle-session", hook_event_name: "UserPromptSubmit", turn_id: "bundle-turn", prompt: "compiled transport test" };
    const started = await invoke(prompt);
    assert.match(started.stdout, /Automatic memory:/);
    const checkpoint = {
      request_id: "bundle-request-1", role: "session", subject: "bundle-transport", session_id: "bundle-session",
      title: "Compiled runner checkpoint", content: "Saved through the MCP SDK HTTP transport", expected_revision: null,
    };
    const staged = JSON.parse((await invoke({ session_id: "bundle-session", hook_event_name: "PostToolUse", checkpoint }, "stage")).stdout) as { staged: boolean; saved: boolean; pending: boolean };
    assert.equal(staged.staged, true);
    assert.equal(staged.saved, true);
    assert.equal(staged.pending, false);
    const stopped = await invoke({ session_id: "bundle-session", hook_event_name: "Stop" });
    assert.doesNotMatch(stopped.stdout, /UNSAVED|failed/);

    const principal = { id: key.id, scopes: ["memory:write", "notes:read"] };
    const current = sessionMemory(principal, { action: "read", runtime: "codex", session_id: "bundle-session" });
    assert.ok("note" in current && current.note);
    const note = current.note;
    assert.equal(stripFrontmatter(note.content), checkpoint.content);
    await invoke({ session_id: "bundle-handoff", hook_event_name: "UserPromptSubmit", turn_id: "handoff-turn" });
    const continued = JSON.parse((await invoke({ session_id: "bundle-handoff", hook_event_name: "Checkpoint", continue: { title: note.title } }, "stage")).stdout) as { continued: boolean; note: { id: string } };
    assert.equal(continued.continued, true, "the compiled runner passes continue through to the server");
    assert.equal(continued.note.id, note.id);
    const overview = { request_id: "bundle-overview-1", role: "overview", subject: "Bundle thread", session_id: "bundle-session", title: "Bundle thread", content: "Next: verify", expected_revision: current.revision };
    for (let i = 0; i < 2; i++) {
      const result = JSON.parse((await invoke({ session_id: "bundle-session", hook_event_name: "Checkpoint", checkpoint: overview, now_line: "verifying transport" }, "stage")).stdout) as { saved: boolean; pending: boolean };
      assert.deepEqual([result.saved, result.pending], [true, false]);
    }
    const now = getDb().prepare("SELECT content FROM notes WHERE folder = ? AND title = ?").get("Agent Memory Test", "Agent Now") as { content: string } | undefined;
    assert.equal(now?.content, `- [[${note.title}]] — verifying transport\n`, "a task change and replay keep one session entry");
    const status = JSON.parse((await invoke({}, "status")).stdout) as { pending: number; last_verified_save: string | null };
    assert.equal(status.pending, 0);
    assert.ok(status.last_verified_save);

    const replay = JSON.parse((await invoke({ session_id: "bundle-session", hook_event_name: "PostToolUse", checkpoint }, "stage")).stdout) as { saved: boolean; pending: boolean };
    assert.equal(replay.saved, true, "the same request identity returns its original verified receipt");
    assert.equal(replay.pending, false);
    const count = (getDb().prepare("SELECT COUNT(*) AS count FROM memory_records WHERE folder = ? AND role = 'session'")
      .get("Agent Memory Test") as { count: number }).count;
    assert.equal(count, 1, "a repeated Stop must not create a duplicate note");
    const latest = sessionMemory(principal, { action: "read", runtime: "codex", session_id: "bundle-session" });
    assert.ok("note" in latest);
    assert.equal(latest.note?.id, note.id);
    const finished = JSON.parse((await invoke({ session_id: "bundle-session", hook_event_name: "Checkpoint", finish: { expected_revision: latest.revision } }, "stage")).stdout);
    assert.equal(finished.saved, true);
    const closed = sessionMemory(principal, { action: "read", runtime: "codex", session_id: "bundle-session" });
    assert.ok("note" in closed);
    assert.equal(closed.note?.id, note.id, "finish keeps the checkpoint as a session record");
    assert.equal(closed.closed, true);

    assert.match((await invoke({}, "--help")).stdout, /Usage:.*status/s, "help lists the controls instead of failing");
    await invoke({ session_id: "conflict-session", hook_event_name: "UserPromptSubmit", turn_id: "conflict-turn" });
    const conflicted = JSON.parse((await invoke({ session_id: "conflict-session", hook_event_name: "Checkpoint", checkpoint: { title: "Conflict fixture", content: "Invented revision" }, expected_revision: "f".repeat(64) }, "stage")).stdout);
    assert.equal(conflicted.pending, true, "a top-level expected_revision reaches the server");
    assert.match(conflicted.systemMessage, /no session checkpoint exists yet; use expected_revision null/i, "the server's conflict detail reaches the agent");

    advertiseLifecycle = false;
    await invoke({ session_id: "old-server-session", hook_event_name: "UserPromptSubmit", turn_id: "old-server-turn" });
    const unsupported = JSON.parse((await invoke({ session_id: "old-server-session", hook_event_name: "Checkpoint", checkpoint: { title: "Old server fixture", content: "Retain this pending contribution", expected_revision: null } }, "stage")).stdout);
    assert.equal(unsupported.pending, true);
    assert.match(unsupported.systemMessage, /Upgrade the Chibako server/);
    advertiseLifecycle = true;
    // The next native event retries the pending contribution.
    await invoke({ session_id: "old-server-session", hook_event_name: "Stop" });
    const retried = JSON.parse((await invoke({}, "inspect", ["--session", "old-server-session"])).stdout);
    assert.equal(retried.pending, null);
    assert.ok(retried.receipt);
    const trashState = sessionMemory(principal, { action: "read", runtime: "codex", session_id: "old-server-session" });
    assert.ok("note" in trashState && trashState.note);
    deleteNote(trashState.note.id);
    const trashed = sessionMemory(principal, { action: "read", runtime: "codex", session_id: "old-server-session" });
    assert.ok("note" in trashed);
    const blocked = JSON.parse((await invoke({ session_id: "old-server-session", hook_event_name: "Checkpoint", checkpoint: { request_id: "trash-pending", title: "Manual trash fixture", content: "Preserve pending work until resolved", expected_revision: trashed.revision } }, "stage")).stdout);
    assert.equal(blocked.pending, true);
    assert.match(blocked.systemMessage, /explicitly finish a trashed checkpoint/);
    const resolved = JSON.parse((await invoke({ session_id: "old-server-session", hook_event_name: "Checkpoint", finish: { expected_revision: trashed.revision }, replaces_request_id: "trash-pending" }, "stage")).stdout);
    assert.equal(resolved.saved, true);
    assert.equal(resolved.pending, false);
    assert.equal(getNote(trashState.note.id), null);

    // Black-box recovery: the runner generates the request ID; the agent learns it only from output and inspect.
    const session_id = "recovery-session";
    const stage = async (input: object, allowFailure = false) => JSON.parse((await invoke({ session_id, hook_event_name: "Checkpoint", ...input }, "stage", ["--session", session_id], allowFailure)).stdout);
    const inspect = async (session = session_id) => {
      const result = await invoke({}, "inspect", ["--session", session]);
      assert.equal(`${result.stdout}${result.stderr}`.includes(key.key), false, "inspect never exposes the profile key");
      return JSON.parse(result.stdout);
    };
    await invoke({ session_id, hook_event_name: "UserPromptSubmit", turn_id: "recovery-turn" });
    const created = await stage({ checkpoint: { title: "Recovery fixture", content: "Base" }, expected_revision: null });
    assert.equal(created.saved, true);
    sessionMemory(principal, { action: "save", runtime: "codex", session_id, request_id: "other-contributor", title: "Recovery fixture", content: "Base + theirs", expected_revision: created.receipt.revision, now_line: "theirs" });
    const stale = await stage({ checkpoint: { title: "Recovery fixture", content: "Base + mine" }, expected_revision: created.receipt.revision });
    assert.equal(stale.pending, true);
    assert.equal(stale.pending_request.failure.category, "conflict");
    assert.equal(stale.pending_request.attempted_revision, created.receipt.revision);
    assert.match(stale.pending_request.recovery, /inspect/);
    const request_id = stale.pending_request.request_id as string;
    const attempts = saveCalls;
    const nextPrompt = await invoke({ session_id, hook_event_name: "UserPromptSubmit", turn_id: "recovery-turn-2" });
    await invoke({ session_id, hook_event_name: "Stop" });
    assert.equal(saveCalls, attempts, "a confirmed stale request is not resent by later hooks");
    assert.equal(nextPrompt.stdout.includes("Base + mine"), false, "routine hook output never carries the pending body");

    const inspected = await inspect();
    assert.equal(inspected.pending.request_id, request_id);
    assert.equal(inspected.pending.checkpoint.content, "Base + mine");
    assert.equal(JSON.stringify(await inspect("bundle-session")).includes("Base + mine"), false, "another session cannot see this contribution");
    const statusOutput = (await invoke({}, "status")).stdout;
    assert.equal(statusOutput.includes(key.key) || statusOutput.includes("Base + mine"), false, "status excludes keys and bodies");

    const latestRead = sessionMemory(principal, { action: "read", runtime: "codex", session_id });
    assert.ok("note" in latestRead && latestRead.note);
    const merged = `${stripFrontmatter(latestRead.note.content)} + mine`;
    for (const rejected of [
      { checkpoint: { title: "Recovery fixture", content: merged }, expected_revision: latestRead.revision, replaces_request_id: "not-the-pending-request" },
      { checkpoint: { title: "Recovery fixture", content: merged }, expected_revision: latestRead.revision },
      { checkpoint: { title: "Recovery fixture", content: merged, request_id }, expected_revision: latestRead.revision, replaces_request_id: request_id },
      { checkpoint: { title: "Recovery fixture", content: merged }, expected_revision: created.receipt.revision, replaces_request_id: request_id },
      { checkpoint: { title: "Recovery fixture", content: merged }, expected_revision: "not-a-revision", replaces_request_id: request_id },
    ]) {
      const result = await stage(rejected, true);
      assert.match(result.systemMessage, /Unsaved checkpoint exists|Invalid memory payload/);
      assert.equal(result.systemMessage.includes(merged), false);
    }
    assert.deepEqual(await inspect(), inspected, "rejected replacements leave the pending contribution intact");
    const untouched = sessionMemory(principal, { action: "read", runtime: "codex", session_id });
    assert.ok("note" in untouched);
    assert.equal(untouched.revision, latestRead.revision, "rejected replacements leave remote data intact");

    const recovered = await stage({ checkpoint: { title: "Recovery fixture", content: merged }, expected_revision: latestRead.revision, replaces_request_id: request_id });
    assert.deepEqual([recovered.saved, recovered.pending], [true, false]);
    const final = sessionMemory(principal, { action: "read", runtime: "codex", session_id });
    assert.ok("note" in final && final.note);
    assert.equal(stripFrontmatter(final.note.content), "Base + theirs + mine", "both contributions survive");
    assert.equal((await inspect()).pending, null);

    // A timeout after the server committed is unverified, never reported as a clean failure.
    await invoke({ session_id: "timeout-session", hook_event_name: "UserPromptSubmit", turn_id: "timeout-turn" });
    delaySaves = true;
    const timedOut = JSON.parse((await invoke({ session_id: "timeout-session", hook_event_name: "Checkpoint", checkpoint: { title: "Timeout fixture", content: "Late response" }, expected_revision: null }, "stage", ["--session", "timeout-session"])).stdout);
    delaySaves = false;
    assert.equal(timedOut.pending, true);
    assert.deepEqual([timedOut.pending_request.failure.category, timedOut.pending_request.failure.phase], ["timeout", "call"]);
    assert.equal(typeof timedOut.pending_request.failure.elapsed_ms, "number");
    assert.match(timedOut.systemMessage, /unverified/);
    assert.equal(/Abort|aborted|127\.0\.0\.1/.test(JSON.stringify(timedOut)), false, "no raw exception detail or endpoint");
    await invoke({ session_id: "timeout-session", hook_event_name: "Stop" });
    const replayed = JSON.parse((await invoke({}, "inspect", ["--session", "timeout-session"])).stdout);
    assert.deepEqual([replayed.pending, replayed.receipt?.request_id], [null, timedOut.pending_request.request_id], "the original request replays its committed receipt");
  } finally {
    await loopback.close();
  }
});

test("packaged Claude, Codex and Hermes runners survive faults, restarts and a shared-checkpoint conflict over authenticated MCP", async (t) => {
  const packages = await buildPackages();
  const runtimes = ["claude", "codex", "hermes"] as const;
  type Runtime = typeof runtimes[number];
  const faults = new Map<string, Array<"precommit" | "lose">>();
  const attempts: Array<Record<string, unknown>> = [];
  const loopback = await startLoopback(t, async (rpc, forward) => {
    const args = rpc?.params?.name === "memory_session" && rpc.params.arguments?.action !== "read" ? rpc.params.arguments : undefined;
    if (!args) return forward();
    attempts.push(args);
    const fault = faults.get(String(args.session_id))?.shift();
    if (fault === "precommit") return { status: 503, headers: { "content-type": "text/plain" }, body: Buffer.from("unavailable") };
    const response = await forward();
    return fault === "lose" ? null : response;
  });
  if (!loopback) return;
  const { endpoint } = loopback;
  const clients: Client[] = [];
  // Count actual Note writes: a unique request ledger row alone cannot detect a replay rewriting data.
  getDb().exec(`CREATE TEMP TABLE packaged_note_writes (note_id TEXT);
    CREATE TEMP TRIGGER packaged_note_insert AFTER INSERT ON notes BEGIN INSERT INTO packaged_note_writes VALUES (NEW.id); END;
    CREATE TEMP TRIGGER packaged_note_update AFTER UPDATE ON notes BEGIN INSERT INTO packaged_note_writes VALUES (NEW.id); END;`);
  try {
    const keys = Object.fromEntries(runtimes.map((runtime) => [runtime, createApiKey(`Packaged ${runtime}`, ["memory:write", "notes:read", "schema:read"])])) as Record<Runtime, ReturnType<typeof createApiKey>>;
    const environment = {
      ...process.env, HOME: root, CHIBAKO_DATA_DIR: process.env.CHIBAKO_DATA_DIR,
      CODEX_HOME: path.join(root, "lifecycle", "codex-home"), CLAUDE_CONFIG_DIR: path.join(root, "lifecycle", "claude-home"), HERMES_HOME: path.join(root, "lifecycle", "hermes-home"),
      CHIBAKO_MEMORY_PROFILE_DIR: undefined, CHIBAKO_MEMORY_PROFILE: undefined, CHIBAKO_MEMORY_ENABLED: undefined,
    } satisfies NodeJS.ProcessEnv;
    const invoke = async (args: string[], input: object) => {
      const output = await run(args, input, environment);
      for (const key of Object.values(keys)) assert.equal(`${output.stdout}${output.stderr}`.includes(key.key), false, "runner output never exposes any profile key");
      return output;
    };
    // Profiles sit where the native hook commands find them without flags.
    for (const runtime of runtimes) {
      const home = environment[runtime === "codex" ? "CODEX_HOME" : runtime === "claude" ? "CLAUDE_CONFIG_DIR" : "HERMES_HOME"];
      await saveProfile(path.join(home, "chibako-memory", runtime, "default"), {
        version: 1, runtime, name: "default", endpoint, api_key: keys[runtime].key, principal_id: keys[runtime].id,
        area: "Agent Memory Test", enabled: true, connected_at: new Date().toISOString(), host: { file: path.join(home, "host-config"), digest: digest("") },
      });
    }
    const runner = (runtime: Runtime) => path.join(packages, runtime, "bin", "memory.mjs");
    const parse = (text: string) => text.trim() ? JSON.parse(text) : {};
    // Host events through each runtime's packaged entry: Claude/Codex hooks.json commands, Hermes through its envelope adapter.
    const fire = (runtime: Runtime, session_id: string, kind: "prompt" | "stop" | "compact" | "start", turn: string = kind) => {
      if (runtime === "hermes") {
        const hook_event_name = { prompt: "pre_llm_call", start: "pre_llm_call", stop: "pre_verify", compact: "post_compaction" }[kind];
        return invoke([path.join(packages, "hermes", "bin", "hermes-hook.mjs")], { hook_event_name, session_id, extra: { turn_id: turn, user_message: "packaged lifecycle" } });
      }
      if (runtime === "codex") {
        const common = { session_id, cwd: root, transcript_path: null, model: "fixture-model" };
        const active = { ...common, turn_id: turn, permission_mode: "dontAsk" };
        const input = {
          prompt: { ...active, hook_event_name: "UserPromptSubmit", prompt: "packaged lifecycle" },
          start: { ...common, hook_event_name: "SessionStart", source: "compact", permission_mode: "dontAsk" },
          stop: { ...active, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: null },
          compact: { ...common, hook_event_name: "PreCompact", turn_id: turn, trigger: "auto" },
        }[kind];
        return invoke([runner(runtime), runtime], input);
      }
      const hook_event_name = { prompt: "UserPromptSubmit", start: "SessionStart", stop: "Stop", compact: "PreCompact" }[kind];
      return invoke([runner(runtime), runtime], { session_id, hook_event_name, turn_id: turn, prompt: "packaged lifecycle", ...(kind === "start" ? { source: "compact" } : {}) });
    };
    const context = (runtime: Runtime, stdout: string): string => runtime === "hermes" ? parse(stdout).context ?? "" : parse(stdout).hookSpecificOutput?.additionalContext ?? "";
    const stage = async (runtime: Runtime, session_id: string, body: object) => parse((await invoke([runner(runtime), runtime, "stage", "--session", session_id], body)).stdout);
    const control = async (runtime: Runtime, action: string, extra: string[] = []) => {
      const { stdout } = await invoke([runner(runtime), runtime, action, ...extra], {});
      return parse(stdout);
    };
    // The agent's supported read: memory_session over the same authenticated loopback transport.
    const client = async (runtime: Runtime) => {
      const connected = new Client({ name: `packaged-${runtime}-agent`, version: "1" });
      await connected.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${keys[runtime].key}` } } }));
      clients.push(connected);
      return connected;
    };
    const agents = Object.fromEntries(await Promise.all(runtimes.map(async (runtime) => [runtime, await client(runtime)]))) as Record<Runtime, Client>;
    const read = async (runtime: Runtime, session_id: string) => {
      const result = await agents[runtime].callTool({ name: "memory_session", arguments: { action: "read", runtime, session_id } });
      return result.structuredContent as { note: { id: string; title: string; content: string } | null; revision: string | null };
    };
    const committed = (request_id: string) => (getDb().prepare("SELECT COUNT(*) AS count FROM memory_session_requests WHERE request_id = ?").get(request_id) as { count: number }).count;

    const listed = (await agents.codex.listTools()).tools.find((tool) => tool.name === "memory_session");
    assert.deepEqual((listed?.inputSchema.properties?.action as { enum?: string[] } | undefined)?.enum, ["read", "save", "finish", "continue"], "the scoped key discovers memory_session actions over loopback");

    // Pre-receipt session state from ddfe12c: no receipt or pending failure fields.
    const previousSession = "previous-release-session";
    const previousCheckpoint = { action: "save", runtime: "codex", session_id: previousSession, request_id: "previous-release-request", title: "Previous release", content: "Preserved before upgrade", expected_revision: null, now_line: "Verify upgrade" };
    const stateDirectory = path.join(environment.CODEX_HOME, "chibako-memory", "codex", "default", "state");
    await privateDirectory(stateDirectory);
    await atomicPrivateWrite(path.join(stateDirectory, `${digest(`codex:${previousSession}`)}.json`), JSON.stringify({
      binding: { endpoint, principal_id: keys.codex.id, area: "Agent Memory Test" },
      turn: "previous-turn", requested: "", acknowledged: "", briefed: true, schemaLoaded: true,
      pending: { turn: "previous-turn", checkpoint: previousCheckpoint },
    }));
    assert.equal((await control("codex", "status")).pending, 1);
    assert.deepEqual((await control("codex", "inspect", ["--session", previousSession])).pending.checkpoint, previousCheckpoint);
    await fire("codex", previousSession, "stop");
    assert.equal(stripFrontmatter((await read("codex", previousSession)).note!.content), previousCheckpoint.content);
    const upgraded = await control("codex", "inspect", ["--session", previousSession]);
    assert.equal(upgraded.pending, null);
    assert.equal(upgraded.receipt.request_id, previousCheckpoint.request_id);

    // Independent sessions run concurrently, each through its own runtime, key and private profile.
    const lifecycle = async (runtime: Runtime) => {
      const session_id = `${runtime}-lifecycle`;
      const title = `Packaged ${runtime} lifecycle`;
      const content = `Saved by the packaged ${runtime} runner`;
      assert.match(context(runtime, (await fire(runtime, session_id, "prompt", "t1")).stdout), /Automatic memory:/);
      faults.set(session_id, ["precommit", "lose"]);
      const first = await stage(runtime, session_id, { checkpoint: { title, content }, expected_revision: null });
      assert.deepEqual([first.pending, first.pending_request.failure.category, first.pending_request.failure.http_status], [true, "http", 503]);
      const request_id: string = first.pending_request.request_id;
      assert.equal(committed(request_id), 0, `${runtime}: a failure before commit writes nothing`);

      const lost = await fire(runtime, session_id, "stop");
      assert.match(`${lost.stdout}${lost.stderr}`, /unverified/, `${runtime}: a lost response is unverified, not failed`);
      assert.equal(committed(request_id), 1, `${runtime}: the write committed although its response was lost`);
      const beforeReplay = await read(runtime, session_id);
      assert.equal((await control(runtime, "status")).pending, 1, `${runtime}: the next process still reports the pending request`);

      const retried = await fire(runtime, session_id, "stop");
      assert.doesNotMatch(`${retried.stdout}${retried.stderr}`, /UNSAVED|unverified/);
      assert.equal(context(runtime, retried.stdout), "", `${runtime}: Stop output cannot reach the model`);
      assert.equal((await fire(runtime, session_id, "compact")).stdout.includes(request_id), false, `${runtime}: compaction or interrupt delivers nothing`);

      const current = await read(runtime, session_id);
      assert.deepEqual(current, beforeReplay, `${runtime}: replay leaves the checkpoint and revision unchanged`);
      const writes = getDb().prepare("SELECT COUNT(*) AS count FROM packaged_note_writes WHERE note_id = ?").get(current.note!.id) as { count: number };
      assert.equal(writes.count, 1, `${runtime}: one Note insert and no replay update`);
      assert.equal(stripFrontmatter(current.note!.content), content);
      const delivered = context(runtime, (await fire(runtime, session_id, "start", "t2")).stdout);
      assert.ok(delivered.includes(`request_id ${request_id};`) && delivered.includes(`revision ${beforeReplay.revision}`), `${runtime}: a restarted process delivers the original durable receipt`);
      const sent = attempts.filter((args) => args.request_id === request_id);
      assert.equal(sent.length, 3, `${runtime}: pre-commit failure, lost response and replay`);
      for (const args of sent) assert.deepEqual(args, sent[0], `${runtime}: retries keep identical identity and body`);
      assert.equal(sent[0].content, content);
      assert.equal(committed(request_id), 1, `${runtime}: exactly one mutation`);
      assert.equal((await control(runtime, "inspect", ["--session", session_id])).receipt.request_id, request_id);

      const later = await stage(runtime, session_id, { checkpoint: { title, content: `${content}; later` }, expected_revision: current.revision });
      assert.deepEqual([later.saved, later.pending], [true, false], `${runtime}: the next save works`);
      assert.notEqual(later.receipt.request_id, request_id);
      return { title: current.note!.title, note_id: later.receipt.note_id as string };
    };
    const results = await Promise.all(runtimes.map(lifecycle));
    assert.equal(new Set(results.map((result) => result.note_id)).size, 3, "independent sessions keep separate checkpoints");

    // Hermes and Codex join Claude's checkpoint, then race on the same revision.
    const shared = results[0];
    const joined: Record<string, { revision: string; note: { id: string; content: string } }> = {};
    for (const runtime of ["hermes", "codex"] as const) {
      const session_id = `${runtime}-joiner`;
      await fire(runtime, session_id, "prompt", "join");
      joined[runtime] = await stage(runtime, session_id, { continue: { title: shared.title } });
      assert.equal(joined[runtime].note.id, shared.note_id);
    }
    const base = stripFrontmatter(joined.codex.note.content);
    const theirs = await stage("hermes", "hermes-joiner", { checkpoint: { title: shared.title, content: `${base}\n+ hermes` }, expected_revision: joined.hermes.revision });
    assert.equal(theirs.saved, true);
    const mine = await stage("codex", "codex-joiner", { checkpoint: { title: shared.title, content: `${base}\n+ codex` }, expected_revision: joined.codex.revision });
    assert.deepEqual([mine.pending, mine.pending_request.failure.category], [true, "conflict"]);
    assert.match(mine.pending_request.recovery, /inspect/);

    const inspected = await control("codex", "inspect", ["--session", "codex-joiner"]);
    assert.equal(inspected.pending.request_id, mine.pending_request.request_id);
    assert.equal(inspected.pending.checkpoint.content, `${base}\n+ codex`);
    const latest = await read("codex", "codex-joiner");
    assert.equal(latest.note!.id, shared.note_id);
    const recovered = await stage("codex", "codex-joiner", { checkpoint: { title: shared.title, content: `${stripFrontmatter(latest.note!.content)}\n+ codex` }, expected_revision: latest.revision, replaces_request_id: inspected.pending.request_id });
    assert.deepEqual([recovered.saved, recovered.pending], [true, false]);
    assert.equal(stripFrontmatter((await read("claude", "claude-lifecycle")).note!.content), `${base}\n+ hermes\n+ codex`, "both contributions survive");
    assert.equal((await control("codex", "inspect", ["--session", "codex-joiner"])).pending, null);
  } finally {
    await Promise.all(clients.map((connected) => connected.close()));
    await loopback.close();
    getDb().exec("DROP TRIGGER packaged_note_insert; DROP TRIGGER packaged_note_update; DROP TABLE packaged_note_writes;");
  }
});
