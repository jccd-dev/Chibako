import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { releaseManifestSchema } from "../src/features/updates/protocol";

// Test decision: add, unit — a retried older workflow run publishing after a newer release must not move `latest`
// (every installed updater would see a downgrade); the comparison is the logic that can silently go wrong.

const promote = (latest: string, version: string) => spawnSync("bash", ["scripts/should-promote.sh", latest, version]).status;

test("only a version newer than the published latest, or the first release, may become latest", () => {
  assert.equal(promote("", "0.1.5"), 0, "first release");
  assert.equal(promote("v0.1.5", "0.1.6"), 0);
  assert.equal(promote("v0.1.9", "0.1.10"), 0, "numeric, not lexical, comparison");
  assert.equal(promote("v0.2.1", "0.2.1"), 0, "an idempotent re-run of the current release");
  assert.equal(promote("v0.1.12", "0.1.9"), 1, "a re-run of an older failed run after a newer release");
  assert.equal(promote("v0.3.1", "0.2.40"), 1, "minor outranks run number");
  assert.equal(promote("v1.0.1", "0.9.99"), 1, "major outranks everything");
  assert.equal(promote("not-a-tag", "0.1.1"), 2, "malformed latest tag fails closed");
  assert.equal(promote("v0.1.1", "0.1"), 2);
});

test("the release workflow moves latest tags and the GitHub latest flag only when the guard allows it", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /should-promote\.sh "\$latest_tag" "\$VERSION"/);
  const promotion = workflow.slice(workflow.indexOf("Scans passed in the publish job"));
  const latestTag = promotion.indexOf('--tag "${repo}:latest"');
  assert.ok(latestTag > promotion.indexOf('if [[ "$promote" == true ]]'), ":latest is only retagged inside the guard");
  assert.match(promotion, /--latest=false/);
  assert.equal(promotion.match(/--latest(?!=)/g)?.length, 1, "exactly one unconditional-looking --latest, inside the guard");
});

test("the workflow-generated release manifest satisfies the updater contract for the configured GitHub repository", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const generator = workflow.match(/^          jq -n [\s\S]*? > assets\/release\.json$/m)?.[0];
  assert.ok(generator, "exercise the actual workflow manifest generator");
  const generated = spawnSync("bash", ["-c", generator.replace(" > assets/release.json", "")], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "jccd-dev/Chibako", GITHUB_SHA: "a".repeat(40),
      VERSION: "0.1.12", tag: "v0.1.12", notes: "- Published release", IMAGE: "ghcr.io/jccd-dev/chibako",
      UPDATER_IMAGE: "ghcr.io/jccd-dev/chibako-updater", APP_DIGEST: `sha256:${"b".repeat(64)}`,
      UPDATER_DIGEST: `sha256:${"c".repeat(64)}`,
    },
  });
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = releaseManifestSchema.parse(JSON.parse(generated.stdout));
  assert.equal(manifest.url, "https://github.com/jccd-dev/chibako/releases/tag/v0.1.12");
  for (const url of [
    "https://github.com/other/chibako/releases/tag/v0.1.12",
    "https://github.com/jccd-dev/other/releases/tag/v0.1.12",
    "https://github.com.evil.test/jccd-dev/chibako/releases/tag/v0.1.12",
  ]) assert.equal(releaseManifestSchema.safeParse({ ...manifest, url }).success, false);
});
