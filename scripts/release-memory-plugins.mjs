// Releases each plugin target independently. A target is released only when its rebuilt plugins/<target>
// output differs from the committed one; it is then bumped, rebuilt and verified. Shared memory tests gate
// every changed target; each target's package test gates only that target. Withheld targets are restored to
// their committed output and version, so nothing partial is left to publish. Used by plugin-release.yml.
// Usage: node scripts/release-memory-plugins.mjs [patch|minor] [all|<target>]; prints per-target results as JSON.
import { execFileSync, spawnSync } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishMemoryPlugins, readVersions, targetNames } from "./build-memory-plugins.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const packageTest = "tests/automatic-memory/automatic-memory-package.test.ts";

export function bumpVersion(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unexpected plugin version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unexpected release level: ${level}`);
}

async function writeVersions(versions) {
  await writeFile(join(root, "plugin-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
}

// Test output goes to stderr so stdout stays the JSON result.
function nodeTests(files, extra = {}) {
  const env = { ...process.env, NODE_ENV: "test", ...extra };
  // Set when this script itself runs under node --test; it would make the nested run report success.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: root, env, stdio: ["ignore", 2, 2] });
  return result.status === 0;
}

// Restores a withheld target's committed output, version and marketplace entry.
async function withhold(target, committed) {
  // A target never released before has no committed output to restore.
  if (git("ls-tree", "HEAD", `plugins/${target}`).trim()) git("checkout", "HEAD", "--", `plugins/${target}`);
  else await rm(join(root, "plugins", target), { recursive: true, force: true });
  git("clean", "-fdq", "--", `plugins/${target}`);
  await writeVersions({ ...(await readVersions()), [target]: committed });
  // Only the Claude target writes the root Claude marketplace entry.
  if (target === "claude") git("checkout", "HEAD", "--", ".claude-plugin/marketplace.json");
}

export async function releaseMemoryPlugins(level = "patch", selection = "all") {
  bumpVersion("0.0.0", level);
  const selected = selection === "all" ? targetNames : [selection];
  if (!selected.every((target) => targetNames.includes(target))) throw new Error(`Unknown plugin target: ${selection}`);
  if (git("status", "--porcelain", "--", "plugins", "plugin-versions.json", ".claude-plugin").trim()) throw new Error("Release needs committed plugins/, plugin-versions.json and .claude-plugin/.");
  const committed = await readVersions();
  // Rebuild at the committed versions: only real output differences count, never a version edit.
  await publishMemoryPlugins(selected);
  const changed = selected.filter((target) => git("status", "--porcelain", "--", `plugins/${target}`).trim());
  const results = Object.fromEntries(selected.map((target) => [target, { status: "unchanged", version: committed[target] }]));
  if (!changed.length) return results;
  const versions = { ...committed };
  for (const target of changed) versions[target] = bumpVersion(committed[target], level);
  await writeVersions(versions);
  await publishMemoryPlugins(changed);

  const shared = (await readdir(join(root, "tests/automatic-memory"))).filter((name) => name.endsWith(".test.ts")).map((name) => `tests/automatic-memory/${name}`).filter((file) => file !== packageTest);
  const sharedPassed = nodeTests(shared);
  for (const target of changed) {
    const reason = !sharedPassed ? "shared memory tests failed" : !nodeTests([packageTest], { CHIBAKO_PLUGIN_TARGET: target }) ? `${target} package tests failed` : "";
    if (reason) {
      await withhold(target, committed[target]);
      results[target] = { status: "withheld", version: committed[target], reason };
    } else results[target] = { status: "released", version: versions[target], previous: committed[target] };
  }
  return results;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const results = await releaseMemoryPlugins(process.argv[2] ?? "patch", process.argv[3] ?? "all");
  console.log(JSON.stringify(results));
}
