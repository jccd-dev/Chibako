import { execFileSync } from "node:child_process";
import path from "node:path";
import { projectSchema } from "../../src/features/memory/types";

/** Lowercase a repository name into the server's project segment; undefined when nothing usable remains. */
export function projectSlug(name: string): string | undefined {
  const slug = name.toLowerCase().replace(/\.git$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
  return projectSchema.safeParse(slug).success ? slug : undefined;
}

/** Profile-owned project hints; both maps are validated by the profile schema. */
export interface ProjectMaps { project_paths?: Record<string, string>; project_aliases?: Record<string, string> }

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim() || undefined;
  } catch { return undefined; }
}

function fromPaths(cwd: string, paths: Record<string, string> = {}): string | undefined {
  const here = path.resolve(cwd);
  const prefix = (key: string) => path.resolve(key);
  const match = Object.keys(paths)
    .filter((key) => here === prefix(key) || here.startsWith(prefix(key).replace(/\/+$/, "") + path.sep))
    .sort((a, b) => prefix(b).length - prefix(a).length)[0];
  return match ? paths[match] : undefined;
}

function fromGit(cwd: string): string | undefined {
  const origin = git(cwd, ["remote", "get-url", "origin"]);
  const fromOrigin = origin && projectSlug(origin.replace(/\/+$/, "").split(/[/:]/).pop() ?? "");
  if (fromOrigin) return fromOrigin;
  // A worktree's common dir is the main checkout's .git, so every worktree shares one project. Bare repos and submodules fall through.
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const fromCommon = common && path.basename(common) === ".git" ? projectSlug(path.basename(path.dirname(common))) : undefined;
  if (fromCommon) return fromCommon;
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? projectSlug(path.basename(root)) : undefined;
}

/** Override, profile path map, origin name, worktree-safe checkout folder, then `workstation`; aliases rename the result once. Only the slug leaves this machine. */
export function resolveProject(cwd: string | undefined, override = process.env.CHIBAKO_MEMORY_PROJECT, maps: ProjectMaps = {}): string {
  const absolute = cwd && path.isAbsolute(cwd) ? cwd : undefined;
  const slug = (override && projectSlug(override))
    || (absolute && fromPaths(absolute, maps.project_paths))
    || (absolute && fromGit(absolute))
    || "workstation";
  return maps.project_aliases?.[slug] ?? slug;
}
