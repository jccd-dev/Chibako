import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { POST as remote } from "../../src/app/mcp/route";
import { getDb } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { saveProfile } from "../../scripts/memory/profile";
import { digest } from "../../scripts/memory/host-config";

const root = mkdtempSync(path.join(tmpdir(), "chibako-memory-bundle-transport-"));
process.env.CHIBAKO_DATA_DIR = path.join(root, "vault");
process.env.CHIBAKO_MEMORY_FOLDER = "Agent Memory Test";
after(() => { getDb().close(); rmSync(root, { recursive: true, force: true }); });

test("compiled runner saves through authenticated MCP HTTP transport and acknowledges one retry-safe note", async (t) => {
  const packages = path.join(root, "packages");
  const builder = pathToFileURL(path.join(process.cwd(), "scripts/build-memory-plugins.mjs")).href;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `const { buildMemoryPlugins } = await import(${JSON.stringify(builder)}); await buildMemoryPlugins(${JSON.stringify(packages)});`], { cwd: process.cwd() });
  const runner = path.join(packages, "codex", "bin", "memory.mjs");
  const key = createApiKey("Compiled memory runner", ["memory:write", "notes:read", "schema:read"]);
  const hostHome = path.join(root, "codex-home");
  const hostFile = path.join(hostHome, "config.toml");
  const profileDirectory = path.join(root, "private-profile");

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
      const request = new Request(`http://127.0.0.1:${listener.port}${incoming.url || "/mcp"}`, { method, headers, ...(body ? { body } : {}) });
      const response = await remote(request);
      const responseBody = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(responseBody);
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
      return;
    }
    throw error;
  }
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;

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
    const invoke = async (input: object, action = "hook") => {
      const child = execFile(process.execPath, [runner, "codex", action, "--profile-dir", profileDirectory], {
        cwd: root, env: environment, encoding: "utf8", timeout: 15_000,
      }, (error, stdout, stderr) => {
        if (error) Object.assign(error, { stdout, stderr });
      });
      const completed = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        child.once("error", reject);
        child.on("close", (code, signal) => {
          const stdout = output.stdout;
          const stderr = output.stderr;
          if (code !== 0) reject(new Error(`runner exited ${code ?? signal}: ${stderr || stdout}`));
          else resolve({ stdout, stderr });
        });
      });
      const output = { stdout: "", stderr: "" };
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { output.stdout += chunk; });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { output.stderr += chunk; });
      child.stdin?.end(JSON.stringify(input));
      return completed;
    };

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

    const note = getDb().prepare("SELECT id, content FROM notes WHERE folder = ? AND title = ?")
      .get("Agent Memory Test", checkpoint.title) as { id: string; content: string } | undefined;
    assert.ok(note);
    assert.equal(note.content, checkpoint.content);
    const overview = { request_id: "bundle-overview-1", role: "overview", subject: "Bundle thread", session_id: "bundle-session", title: "Bundle thread", content: "# Bundle thread\nNext: verify", expected_revision: null };
    for (let i = 0; i < 2; i++) {
      const result = JSON.parse((await invoke({ session_id: "bundle-session", hook_event_name: "Checkpoint", checkpoint: overview, now_line: "verifying transport" }, "stage")).stdout) as { saved: boolean; pending: boolean };
      assert.deepEqual([result.saved, result.pending], [true, false]);
    }
    const now = getDb().prepare("SELECT content FROM notes WHERE folder = ? AND title = ?").get("Agent Memory Test", "Now") as { content: string } | undefined;
    assert.equal(now?.content, "# Now\n\n- [[Bundle thread]] — verifying transport\n", "replay keeps one Now line");
    const status = JSON.parse((await invoke({}, "status")).stdout) as { pending: number; last_verified_save: string | null };
    assert.equal(status.pending, 0);
    assert.ok(status.last_verified_save);

    const replay = JSON.parse((await invoke({ session_id: "bundle-session", hook_event_name: "PostToolUse", checkpoint }, "stage")).stdout) as { saved: boolean; pending: boolean };
    assert.equal(replay.saved, true, "the same request identity returns its original verified receipt");
    assert.equal(replay.pending, false);
    const count = (getDb().prepare("SELECT COUNT(*) AS count FROM notes WHERE folder = ? AND title = ?")
      .get("Agent Memory Test", checkpoint.title) as { count: number }).count;
    assert.equal(count, 1, "a repeated Stop must not create a duplicate note");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
