import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { test } from "node:test";
import { z } from "zod";

// hooks/list backs Codex's /hooks browser; use the installed CLI, not a simulated plugin copier.
async function listHooks(cwd: string, env: NodeJS.ProcessEnv): Promise<unknown> {
  const child = spawn("codex", ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(child, "close");
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  const send = (value: object) => child.stdin.write(`${JSON.stringify(value)}\n`);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Codex hooks/list timed out")), 15_000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Codex app-server exited before hooks/list")));
      lines.on("line", (line) => {
        try {
          const message = z.object({ id: z.number().optional(), result: z.unknown().optional(), error: z.unknown().optional() }).parse(JSON.parse(line));
          if (message.id !== 1 && message.id !== 2) return;
          if (message.error) throw new Error(`Codex RPC failed: ${JSON.stringify(message.error)}`);
          if (message.id === 2) { resolve(message.result); return; }
          send({ method: "initialized" });
          send({ id: 2, method: "hooks/list", params: { cwds: [cwd] } });
        } catch (error) { reject(error); }
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "chibako-install-test", version: "1.0.0" }, capabilities: { experimentalApi: true } } });
    });
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
    await closed;
  }
}

test("Codex marketplace installation preserves hook files and registers all six plugin hooks", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "chibako-codex-install-"));
  const home = path.join(temporary, "codex-home");
  const repository = path.join(temporary, "marketplace");
  const env = { PATH: process.env.PATH, HOME: temporary, CODEX_HOME: home, NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
  const run = (args: string[]) => promisify(execFile)("codex", args, { cwd: temporary, env, timeout: 15_000 });
  try {
    await mkdir(home);
    try { await run(["--version"]); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        t.skip("Codex CLI is not installed; native marketplace installation remains unverified");
        return;
      }
      throw error;
    }
    await mkdir(path.join(repository, ".agents/plugins"), { recursive: true });
    await writeFile(path.join(repository, ".agents/plugins/marketplace.json"), await readFile(".agents/plugins/marketplace.json"));
    await promisify(execFile)(process.execPath, [path.resolve("scripts/build-memory-plugins.mjs"), path.join(repository, "plugins"), "codex"], { cwd: temporary, env });
    await run(["plugin", "marketplace", "add", repository, "--json"]);
    const installed = z.object({ installedPath: z.string() }).parse(JSON.parse((await run(["plugin", "add", "chibako@chibako-plugins", "--json"])).stdout));
    for (const file of [".codex-plugin/plugin.json", "hooks/hooks.json", "bin/memory.mjs", "skills/chibako-memory-setup/SKILL.md"]) {
      const hash = (content: Buffer) => createHash("sha256").update(content).digest("hex");
      assert.equal(hash(await readFile(path.join(installed.installedPath, file))), hash(await readFile(path.join(repository, "plugins/codex", file))), file);
    }
    const listing = z.object({ data: z.array(z.object({
      errors: z.array(z.unknown()), warnings: z.array(z.string()),
      hooks: z.array(z.object({ eventName: z.string(), source: z.string(), sourcePath: z.string(), trustStatus: z.string(), command: z.string() })),
    })) }).parse(await listHooks(temporary, env));
    assert.equal(listing.data.length, 1);
    const entry = listing.data[0];
    assert.deepEqual(entry.errors, []);
    assert.deepEqual(entry.warnings, []);
    assert.deepEqual(entry.hooks.map((hook) => hook.eventName).sort(), ["interrupt", "postToolUse", "preCompact", "sessionStart", "stop", "userPromptSubmit"]);
    for (const hook of entry.hooks) {
      assert.equal(hook.source, "plugin");
      assert.equal(hook.sourcePath, path.join(installed.installedPath, "hooks/hooks.json"));
      assert.equal(hook.command, `node "${path.join(installed.installedPath, "bin/memory.mjs")}" codex`);
      assert.equal(hook.trustStatus, "untrusted", "installation registers hooks but does not grant consent");
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
