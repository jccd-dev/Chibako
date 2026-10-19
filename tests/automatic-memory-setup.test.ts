import { renderHostConfig } from "../scripts/memory/host-config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { after, test } from "node:test";
import { validateMemoryStatus } from "../scripts/memory/connection";
import { runControl } from "../scripts/memory/controls";
import { applySetup, disconnect, prepareSetup, redactedPreview, setEnabled } from "../scripts/memory/setup";
import { profileDirectory, readProfile } from "../scripts/memory/profile";
import type { MemoryCall, Runtime } from "../scripts/memory/runtime";

const root = mkdtempSync(join(tmpdir(), "chibako-memory-setup-test-"));
after(() => rmSync(root, { recursive: true, force: true }));
const scopes = ["notes:read", "schema:read", "memory:write"];

function fixture(runtime: Runtime, name = "default") {
  const base = join(root, `${runtime}-${name}`);
  const directory = join(base, "private", "profile");
  const hostFile = join(base, "host", runtime === "codex" ? "config.toml" : runtime === "claude" ? ".claude.json" : "config.yaml");
  mkdirSync(join(base, "host"), { recursive: true });
  const original = runtime === "codex" ? "# keep this comment\n[other]\nvalue = 7\n"
    : runtime === "claude" ? JSON.stringify({ custom: { keep: true }, mcpServers: { other: { url: "https://other.test/mcp" } } }, null, 2) + "\n"
    : "custom:\n  keep: true\nmcp_servers:\n  other:\n    url: https://other.test/mcp\n";
  writeFileSync(hostFile, original, { mode: 0o600 });
  return { directory, hostFile, original, endpoint: "https://vault.example/mcp", key: "test-secret-key" };
}

function stub(principalId = "profile-1", calls: string[] = []): MemoryCall {
  return async (name) => {
    calls.push(name);
    if (name === "memory_status") return {
      contract_version: 1, principal_id: principalId, scopes, enabled: true, area: "Agent Memory",
    };
    return { ok: true };
  };
}

function input(runtime: Runtime, name = "default") {
  return { runtime, name, ...fixture(runtime, name) };
}

test("setup validates the exact key scopes and server contract", () => {
  const base = { contract_version: 1, principal_id: "profile-1", scopes, enabled: true, area: "Agent Memory" };
  assert.deepEqual(validateMemoryStatus(base), base);
  assert.throws(() => validateMemoryStatus({ ...base, scopes: ["notes:read", "schema:read"] }), /missing required/);
  assert.throws(() => validateMemoryStatus({ ...base, scopes: [...scopes, "notes:write"] }), /excessive scopes/);
  assert.throws(() => validateMemoryStatus({ ...base, contract_version: 2 }), /contract is incompatible/);
  assert.throws(() => validateMemoryStatus({ ...base, enabled: false, area: null }), /disabled/);
});

test("preparation is read-only, probes status/schema/recall, and redacts the key", async () => {
  const target = input("codex", "cancelled");
  const calls: string[] = [];
  const preview = await prepareSetup(target, stub("profile-1", calls));
  assert.deepEqual(calls, ["memory_status", "get_knowledge_schema", "recall"]);
  assert.equal(readFileSync(target.hostFile, "utf8"), target.original);
  assert.equal(await readProfile(target.directory), null);
  const summary = JSON.stringify(redactedPreview(preview));
  assert.equal(summary.includes(target.key), false);
  assert.match(summary, /credentials.*hidden/);
  assert.equal(summary.includes("test-secret-key"), false);
});

test("apply preserves unrelated host configuration for Codex, Claude and Hermes", async () => {
  for (const runtime of ["codex", "claude", "hermes"] as const) {
    const target = input(runtime, "preserve");
    const preview = await prepareSetup(target, stub());
    const profile = await applySetup(preview);
    assert.equal(profile.enabled, false, "automatic memory remains off after setup");
    assert.equal(profile.api_key, target.key);
    const text = readFileSync(target.hostFile, "utf8");
    assert.ok(text.includes("chibako-memory"));
    if (runtime === "codex") assert.ok(text.includes("# keep this comment"));
    if (runtime === "claude") {
      const config = JSON.parse(text);
      assert.deepEqual(config.custom, { keep: true });
      assert.deepEqual(config.mcpServers.other, { url: "https://other.test/mcp" });
      assert.equal(config.mcpServers["chibako-memory"].headers.Authorization, `Bearer ${target.key}`);
    }
    if (runtime === "hermes") {
      const config = load(text) as { custom: { keep: boolean }; mcp_servers: Record<string, { url?: string; headers?: { Authorization?: string } }> };
      assert.deepEqual(config.custom, { keep: true });
      assert.equal(config.mcp_servers.other.url, "https://other.test/mcp");
      assert.equal(config.mcp_servers["chibako-memory"].headers?.Authorization, `Bearer ${target.key}`);
    }
    assert.equal((await readProfile(target.directory))?.host.file, target.hostFile);
  }
});

test("pause does not call the server; resume checks principal before enabling", async () => {
  const target = input("claude", "pause");
  await applySetup(await prepareSetup(target, stub("profile-1")));
  const calls: string[] = [];
  await setEnabled(target.directory, false, stub("profile-1", calls));
  assert.deepEqual(calls, []);
  await assert.rejects(() => setEnabled(target.directory, true, stub("rotated-key", calls)), /identity or memory area changed/);
  assert.deepEqual(calls, ["memory_status"]);
  assert.equal((await readProfile(target.directory))?.enabled, false);
});

test("pending checkpoints prevent retargeting and remain when disconnect removes only its connection", async () => {
  const target = input("claude", "pending");
  await applySetup(await prepareSetup(target, stub("profile-1")));
  const pendingFile = join(target.directory, "state", "pending.json");
  mkdirSync(join(target.directory, "state"), { recursive: true, mode: 0o700 });
  writeFileSync(pendingFile, JSON.stringify({ pending: { retained: true } }), { mode: 0o600 });
  await assert.rejects(() => prepareSetup({ ...target, endpoint: "https://other.example/mcp" }, stub("profile-2")), /Pending checkpoints belong/);
  await disconnect(target.directory);
  const config = JSON.parse(readFileSync(target.hostFile, "utf8"));
  assert.deepEqual(config.custom, { keep: true });
  assert.deepEqual(config.mcpServers, { other: { url: "https://other.test/mcp" } });
  assert.deepEqual(JSON.parse(readFileSync(pendingFile, "utf8")), { pending: { retained: true } });
  const profile = await readProfile(target.directory);
  assert.equal(profile?.enabled, false);
  assert.equal(profile?.api_key, "");
});

test("apply refuses to overwrite a host config edited after preview", async () => {
  const target = input("hermes", "collision");
  const preview = await prepareSetup(target, stub());
  writeFileSync(target.hostFile, `${target.original}# user edit\n`);
  await assert.rejects(() => applySetup(preview), /Host configuration changed during setup/);
  assert.equal(readFileSync(target.hostFile, "utf8"), `${target.original}# user edit\n`);
  assert.equal(await readProfile(target.directory), null);
});

test("a valid setup can be rerun and an edited managed connection requires review", async () => {
  const target = input("claude", "rerun");
  const call = stub();
  await applySetup(await prepareSetup(target, call));
  await applySetup(await prepareSetup(target, call));
  assert.equal((await readProfile(target.directory))?.endpoint, target.endpoint);

  const edited = JSON.parse(readFileSync(target.hostFile, "utf8"));
  edited.mcpServers["chibako-memory"].url = "https://edited.example/mcp";
  writeFileSync(target.hostFile, JSON.stringify(edited, null, 2) + "\n");
  await assert.rejects(() => prepareSetup(target, call), /already exists or was changed outside setup/);
});

test("resume rejects an externally edited host connection before server calls", async () => {
  const target = input("claude", "host-edit");
  await applySetup(await prepareSetup(target, stub()));
  const edited = JSON.parse(readFileSync(target.hostFile, "utf8"));
  edited.mcpServers["chibako-memory"].url = "https://edited.example/mcp";
  writeFileSync(target.hostFile, JSON.stringify(edited, null, 2) + "\n");
  const calls: string[] = [];
  await assert.rejects(() => setEnabled(target.directory, true, stub("profile-1", calls)), /already exists or was changed outside setup/);
  assert.deepEqual(calls, []);
  await assert.rejects(() => runControl("claude", "doctor", target.directory, "host-edit"), /already exists or was changed outside setup/);
});

test("profile path uses the native host home with or without plugin-only environment", () => {
  const previous = {
    home: process.env.HOME, pluginData: process.env.PLUGIN_DATA,
    profileDir: process.env.CHIBAKO_MEMORY_PROFILE_DIR,
    codexHome: process.env.CODEX_HOME, claudeConfig: process.env.CLAUDE_CONFIG_DIR, hermesHome: process.env.HERMES_HOME,
  };
  try {
    process.env.HOME = root;
    delete process.env.CHIBAKO_MEMORY_PROFILE_DIR;
    process.env.CODEX_HOME = join(root, "codex-home");
    process.env.CLAUDE_CONFIG_DIR = join(root, "claude-home");
    process.env.HERMES_HOME = join(root, "hermes-home");
    process.env.PLUGIN_DATA = join(root, "plugin-only-data");
    const withPluginData = (["codex", "claude", "hermes"] as const).map((runtime) => profileDirectory(runtime, "default"));
    delete process.env.PLUGIN_DATA;
    const withoutPluginData = (["codex", "claude", "hermes"] as const).map((runtime) => profileDirectory(runtime, "default"));
    assert.deepEqual(withoutPluginData, withPluginData);
    assert.ok(withoutPluginData.every((directory) => !directory.startsWith(join(root, "plugin-only-data"))));
  } finally {
    for (const [key, value] of Object.entries({
      HOME: previous.home, PLUGIN_DATA: previous.pluginData, CHIBAKO_MEMORY_PROFILE_DIR: previous.profileDir,
      CODEX_HOME: previous.codexHome, CLAUDE_CONFIG_DIR: previous.claudeConfig, HERMES_HOME: previous.hermesHome,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("interactive setup hides the API key and cancellation or connection failure writes no config", { skip: process.platform === "win32" || spawnSync("python3", ["--version"]).status !== 0 }, () => {
  const driver = String.raw`
import os, pty, select, signal, sys, time
node, entry, profile, key, mode = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(node, [node, "--import", "tsx", entry, "hermes", "setup", "--profile-dir", profile], os.environ)
output = bytearray()
def wait_for(marker, timeout=10):
    deadline = time.monotonic() + timeout
    while marker not in output and time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(fd, 65536)
                if not chunk: break
                output.extend(chunk)
            except OSError: break
    if marker not in output:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        try: os.waitpid(pid, 0)
        except ChildProcessError: pass
        sys.stdout.buffer.write(output)
        raise RuntimeError("setup prompt timed out: " + repr(bytes(output)))
wait_for(b"Chibako MCP URL: ")
os.write(fd, b"https://127.0.0.1:1/mcp\r")
wait_for(b"Restricted Chibako API key (hidden): ")
if mode == "cancel":
    os.write(fd, key.encode())
    time.sleep(0.15)
    os.write(fd, b"\x03")
else:
    os.write(fd, key.encode() + b"\r")
deadline = time.monotonic() + 12
status = None
while time.monotonic() < deadline:
    waited, status = os.waitpid(pid, os.WNOHANG)
    if waited: break
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(fd, 65536)
            if not chunk: break
            output.extend(chunk)
        except OSError: break
else:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    raise RuntimeError("setup process did not exit")
while True:
    ready, _, _ = select.select([fd], [], [], 0)
    if not ready: break
    try:
        chunk = os.read(fd, 65536)
        if not chunk: break
        output.extend(chunk)
    except OSError: break
sys.stdout.buffer.write(output)
`;
  const key = `synthetic-key-${Date.now()}-must-stay-hidden`;
  for (const mode of ["submit", "cancel"] as const) {
    const base = join(root, `pty-${mode}`);
    const profile = join(base, "profile");
    const home = join(base, "hermes-home");
    mkdirSync(base, { recursive: true });
    const result = spawnSync("python3", ["-c", driver, process.execPath, resolve("scripts/agent-memory.ts"), profile, key, mode], {
      cwd: process.cwd(), env: { ...process.env, HERMES_HOME: home }, encoding: "utf8", timeout: 20_000,
    });
    assert.equal(result.error, undefined, `${result.stderr || ""}${result.stdout || ""}`);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(key), false, "the hidden credential must not appear in terminal output or error text");
    assert.equal(existsSync(join(profile, "profile.json")), false);
    assert.equal(existsSync(join(home, "config.yaml")), false);
    if (mode === "submit") assert.match(result.stdout, /connection or authentication failed/);
  }
});

test("Hermes YAML aliases do not add the managed connection to unrelated defaults", () => {
  const original = "defaults: &servers\n  other:\n    url: https://other.test/mcp\nmcp_servers: *servers\n";
  const rendered = renderHostConfig("hermes", original, "https://vault.example/mcp", "synthetic-key");
  const parsed = load(rendered.text) as { defaults: Record<string, unknown>; mcp_servers: Record<string, unknown> };
  assert.deepEqual(Object.keys(parsed.defaults), ["other"]);
  assert.ok(parsed.mcp_servers["chibako-memory"]);
});
