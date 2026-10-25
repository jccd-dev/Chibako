import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
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

test("the override wins, then the origin repository name, then the checkout folder; non-repos have none", () => {
  const root = mkdtempSync(join(tmpdir(), "chibako-project-"));
  try {
    const repo = join(root, "Local Checkout");
    mkdirSync(join(repo, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    assert.equal(resolveProject(join(repo, "src"), ""), "local-checkout");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:owner/Atlas.git"]);
    assert.equal(resolveProject(join(repo, "src"), ""), "atlas");
    assert.equal(resolveProject(join(repo, "src"), "Override"), "override");
    assert.equal(resolveProject(root, ""), undefined);
    assert.equal(resolveProject(undefined, ""), undefined);
    assert.equal(resolveProject("relative/path", ""), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
