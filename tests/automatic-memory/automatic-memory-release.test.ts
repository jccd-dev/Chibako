import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
type Results = Record<string, { status: string; version: string; reason?: string }>;

// A disposable repository with the real build/release scripts and sources; tests are fixtures that pass or fail on demand.
async function fixtureRepository() {
  const repository = await mkdtemp(path.join(tmpdir(), "chibako-release-"));
  for (const entry of ["scripts", "skills", "integrations/agent-memory", "src/features/memory/types.ts", "LICENSE", "plugin.json", ".claude-plugin", ".agents"]) {
    await cp(path.join(root, entry), path.join(repository, entry), { recursive: true });
  }
  // A fixed baseline: the repository's own versions move with every release this test gates.
  await writeFile(path.join(repository, "plugin-versions.json"), `${JSON.stringify({ claude: "1.0.0", codex: "1.0.0", hermes: "1.0.0" }, null, 2)}\n`);
  await symlink(path.join(root, "node_modules"), path.join(repository, "node_modules"));
  await mkdir(path.join(repository, "tests/automatic-memory"), { recursive: true });
  await writeFile(path.join(repository, "tests/automatic-memory/shared.test.ts"), `import test from "node:test";\ntest("shared", () => { if (process.env.FAIL_SHARED) throw new Error("shared invariant"); });\n`);
  await writeFile(path.join(repository, "tests/automatic-memory/automatic-memory-package.test.ts"), `import test from "node:test";\ntest("package", () => { if (process.env.CHIBAKO_PLUGIN_TARGET === process.env.FAIL_TARGET) throw new Error("target"); });\n`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  execFileSync(process.execPath, ["scripts/build-memory-plugins.mjs", "--publish"], { cwd: repository });
  git("add", "-A");
  git("commit", "-qm", "baseline");
  const release = (env: Record<string, string> = {}, ...args: string[]): Results =>
    JSON.parse(execFileSync(process.execPath, ["scripts/release-memory-plugins.mjs", ...args], { cwd: repository, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "ignore"] }));
  const edit = async (file: string, from: string, to: string) => {
    const content = await readFile(path.join(repository, file), "utf8");
    assert.ok(content.includes(from), `${file} contains ${from}`);
    await writeFile(path.join(repository, file), content.replace(from, to));
  };
  const read = async (file: string) => JSON.parse(await readFile(path.join(repository, file), "utf8"));
  const changed = () => git("status", "--porcelain").split("\n").filter(Boolean).map((line) => line.slice(3));
  const commit = (message: string) => { git("add", "-A"); git("commit", "-qm", message); };
  return { repository, release, edit, read, changed, commit };
}

const statuses = (results: Results) => Object.fromEntries(Object.entries(results).map(([target, result]) => [target, result.status]));

test("a host-specific change releases only that target, and a rerun releases nothing", async () => {
  const fixture = await fixtureRepository();
  try {
    const before = await fixture.read("plugin-versions.json");
    await fixture.edit("scripts/memory/codex/adapter.ts", "Codex configuration validation failed.", "Codex configuration check failed.");
    fixture.commit("codex adapter change");
    const results = fixture.release();
    assert.deepEqual(statuses(results), { codex: "released", claude: "unchanged", hermes: "unchanged" });
    assert.deepEqual(await fixture.read("plugin-versions.json"), { ...before, codex: "1.0.1" });
    assert.ok(fixture.changed().every((file) => file === "plugin-versions.json" || file.startsWith("plugins/codex/")), fixture.changed().join(", "));
    assert.equal((await fixture.read("plugins/codex/.codex-plugin/plugin.json")).version, "1.0.1");
    assert.equal((await fixture.read("plugins/codex/plugin.json")).version, "1.0.1");
    fixture.commit("release codex");
    assert.deepEqual(statuses(fixture.release()), { codex: "unchanged", claude: "unchanged", hermes: "unchanged" }, "a successful release is not bumped again");
    assert.deepEqual(fixture.changed(), []);

    // Representative isolation for another target, with a minor bump.
    await fixture.edit("scripts/memory/claude/adapter.ts", '".claude/settings.local.json"', '".claude/settings.local.jsonc"');
    fixture.commit("claude adapter change");
    assert.deepEqual(statuses(fixture.release({}, "minor")), { codex: "unchanged", claude: "released", hermes: "unchanged" });
    assert.deepEqual(await fixture.read("plugin-versions.json"), { ...before, codex: "1.0.1", claude: "1.1.0" });
    assert.equal((await fixture.read(".claude-plugin/marketplace.json")).plugins[0].version, "1.1.0", "the marketplace lists the Claude package's own version");
    assert.equal((await fixture.read("plugins/claude/.claude-plugin/plugin.json")).version, "1.1.0");
  } finally {
    await rm(fixture.repository, { recursive: true, force: true });
  }
});

test("a shared change reaches every target; failures withhold without partial output", async () => {
  const fixture = await fixtureRepository();
  try {
    const before = await fixture.read("plugin-versions.json");
    await fixture.edit("scripts/memory/runtime.ts", "Memory retrieval unavailable.", "Memory retrieval is unavailable.");
    fixture.commit("shared engine change");

    const sharedFailure = fixture.release({ FAIL_SHARED: "1" });
    assert.deepEqual(statuses(sharedFailure), { codex: "withheld", claude: "withheld", hermes: "withheld" });
    assert.equal(sharedFailure.codex.reason, "shared memory tests failed");
    assert.deepEqual(fixture.changed(), [], "nothing is left to publish");

    const manual = fixture.release({}, "patch", "hermes");
    assert.deepEqual(statuses(manual), { hermes: "released" }, "a manual selection touches only its target");
    assert.ok(fixture.changed().every((file) => file === "plugin-versions.json" || file.startsWith("plugins/hermes/")), fixture.changed().join(", "));
    execFileSync("git", ["checkout", "-q", "--", "."], { cwd: fixture.repository });

    const targetFailure = fixture.release({ FAIL_TARGET: "claude" });
    assert.deepEqual(statuses(targetFailure), { codex: "released", claude: "withheld", hermes: "released" });
    assert.equal(targetFailure.claude.reason, "claude package tests failed");
    assert.deepEqual(await fixture.read("plugin-versions.json"), { ...before, codex: "1.0.1", hermes: "1.0.1" });
    assert.ok(fixture.changed().every((file) => file === "plugin-versions.json" || file.startsWith("plugins/codex/") || file.startsWith("plugins/hermes/")), fixture.changed().join(", "));
    assert.equal((await fixture.read(".claude-plugin/marketplace.json")).plugins[0].version, before.claude);
    fixture.commit("release codex and hermes");
    assert.deepEqual(statuses(fixture.release()), { codex: "unchanged", claude: "released", hermes: "unchanged" }, "a retry releases the withheld target");
  } finally {
    await rm(fixture.repository, { recursive: true, force: true });
  }
});
