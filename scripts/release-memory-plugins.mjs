// Bumps the plugin version only when a rebuild changes the committed plugins/ output.
// Prints the new version, or nothing when there is nothing to release. Used by plugin-release.yml.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishMemoryPlugins } from "./build-memory-plugins.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function bumpVersion(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unexpected plugin version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unexpected release level: ${level}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const level = process.argv[2] ?? "patch";
  bumpVersion("0.0.0", level);
  await publishMemoryPlugins();
  if (!execFileSync("git", ["status", "--porcelain", "--", "plugins"], { cwd: root, encoding: "utf8" }).trim()) process.exit(0);
  const path = join(root, "plugin.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.version = bumpVersion(manifest.version, level);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  await publishMemoryPlugins();
  console.log(manifest.version);
}
