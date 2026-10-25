import { execFileSync } from "node:child_process";
import path from "node:path";
import { projectSchema } from "../../src/features/memory/types";

/** Lowercase a repository name into the server's project segment; undefined when nothing usable remains. */
export function projectSlug(name: string): string | undefined {
  const slug = name.toLowerCase().replace(/\.git$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
  return projectSchema.safeParse(slug).success ? slug : undefined;
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim() || undefined;
  } catch { return undefined; }
}

/** Override, then the origin repository name, then the checkout folder name. Only the slug leaves this machine. */
export function resolveProject(cwd: string | undefined, override = process.env.CHIBAKO_MEMORY_PROJECT): string | undefined {
  if (override) return projectSlug(override);
  if (!cwd || !path.isAbsolute(cwd)) return undefined;
  const origin = git(cwd, ["remote", "get-url", "origin"]);
  const fromOrigin = origin && projectSlug(origin.replace(/\/+$/, "").split(/[/:]/).pop() ?? "");
  if (fromOrigin) return fromOrigin;
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? projectSlug(path.basename(root)) : undefined;
}
