import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectSlug, resolveProject } from "../../scripts/memory/project";

test("project slugs are safe single folder segments", () => {
  assert.equal(projectSlug("Chibako.git"), "chibako");
  assert.equal(projectSlug("My Repo!"), "my-repo-");
  assert.equal(projectSlug("..hidden"), "hidden");
  assert.equal(projectSlug("___"), undefined);
  assert.equal(projectSlug("x".repeat(80))!.length, 64);
});

test("the override wins, then the origin repository name, then the checkout folder", () => {
  const root = mkdtempSync(join(tmpdir(), "chibako-project-"));
  try {
    const repo = join(root, "Local Checkout");
    mkdirSync(join(repo, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    assert.equal(resolveProject(join(repo, "src"), ""), "local-checkout");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:owner/Atlas.git"]);
    assert.equal(resolveProject(join(repo, "src"), ""), "atlas");
    assert.equal(resolveProject(join(repo, "src"), "Override"), "override");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("worktrees collapse to the main checkout, and non-projects land in workstation", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chibako-project-")));
  try {
    const repo = join(root, "Main Repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
    const tree = join(root, "feature-branch-dir");
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "feature", tree]);
    assert.equal(resolveProject(tree, ""), "main-repo");
    assert.equal(resolveProject(root, ""), "workstation");
    assert.equal(resolveProject(undefined, ""), "workstation");
    assert.equal(resolveProject("relative/path", ""), "workstation");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("profile path mapping uses the longest prefix at a folder boundary and beats git", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chibako-project-")));
  try {
    const repo = join(root, "work", "app");
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    const config = { project_paths: { [join(root, "work")]: "client", [repo]: "app-x", [join(root, "wo")]: "wrong" } };
    assert.equal(resolveProject(join(repo, "src"), "", config), "app-x");
    assert.equal(resolveProject(join(root, "work", "other"), "", config), "client");
    assert.equal(resolveProject(join(root, "work-elsewhere"), "", config), "workstation");
    assert.equal(resolveProject(repo, "Forced", config), "forced");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("aliases are applied last, to every source, once", () => {
  const config = { project_paths: { "/tmp/some-place": "old-name" }, project_aliases: { "old-name": "new-name", "new-name": "newer", workstation: "scratch", forced: "alias-of-forced" } };
  assert.equal(resolveProject("/tmp/some-place/x", "", config), "new-name");
  assert.equal(resolveProject("/nonexistent-zzz", "", config), "scratch");
  assert.equal(resolveProject("/tmp", "Forced", config), "alias-of-forced");
});
