import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configSchema } from "../updater/config";

// Test decision: add, integration — the installer writes host files next to user data; reruns, adoption, and
// uninstall must never overwrite config or data. Real script, real files, fake docker/uname only.

const APP_V1 = `ghcr.io/jccd-dev/chibako@sha256:${"1".repeat(64)}`;
const APP_V2 = `ghcr.io/jccd-dev/chibako@sha256:${"2".repeat(64)}`;
const UPD_V1 = `ghcr.io/jccd-dev/chibako-updater@sha256:${"3".repeat(64)}`;
const UPD_V2 = `ghcr.io/jccd-dev/chibako-updater@sha256:${"4".repeat(64)}`;
const CHANNEL_MODES = { updater: 0o755, channel: 0o755, in: 0o1777, out: 0o755 };
const channelModes = (home: string) => ({
  updater: statSync(join(home, "updater")).mode & 0o7777, channel: statSync(join(home, "updater/channel")).mode & 0o7777,
  in: statSync(join(home, "updater/channel/in")).mode & 0o7777, out: statSync(join(home, "updater/channel/out")).mode & 0o7777,
});
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chibako-installer-")));
  const bin = join(root, "bin"), fake = join(root, "fake"), release = join(root, "release"), home = join(root, "home");
  for (const dir of [bin, fake, release]) mkdirSync(dir);
  copyFileSync(join(process.cwd(), "tests/fixtures/fake-docker.sh"), join(bin, "docker"));
  writeFileSync(join(bin, "uname"), '#!/bin/sh\n[ "$1" = "-m" ] && echo x86_64 || echo Linux\n');
  for (const name of ["docker", "uname"]) chmodSync(join(bin, name), 0o755);
  writeFileSync(join(fake, "versions"), "");
  copyFileSync(join(process.cwd(), "docker-compose.release.yml"), join(release, "docker-compose.release.yml"));
  const publish = (app: string, updater: string, version: string) =>
    writeFileSync(join(release, "release.env"), `CHIBAKO_RELEASE_VERSION=${version}\nCHIBAKO_IMAGE=${app}\nCHIBAKO_UPDATER_IMAGE=${updater}\n`);
  publish(APP_V1, UPD_V1, "0.1.1");
  const run = (args: string[], extra: Record<string, string> = {}) => spawnSync("bash", [join(process.cwd(), "scripts/install.sh"), ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE: fake, FAKE_PIN_FILE: "/dev/null", CHIBAKO_HOME: home, CHIBAKO_RELEASE_BASE: `file://${release}`, ...extra },
  });
  return { root, home, fake, publish, run, calls: () => (existsSync(join(fake, "log")) ? readFileSync(join(fake, "log"), "utf8") : ""), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a fresh install provisions the app and updater once, with private config and a setup token", () => {
  const t = setup();
  try {
    const result = t.run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /setup token/i);
    const env = readFileSync(join(t.home, ".env"), "utf8");
    assert.match(env, /^CHIBAKO_SETUP_TOKEN=[0-9a-f]{64}$/m);
    assert.equal(statSync(join(t.home, ".env")).mode & 0o777, 0o600);
    assert.match(readFileSync(join(t.home, "pin.env"), "utf8"), new RegExp(`CHIBAKO_IMAGE=${APP_V1}\\nCHIBAKO_UPDATER_IMAGE=${UPD_V1}`));
    configSchema.parse(JSON.parse(readFileSync(join(t.home, "updater/config.json"), "utf8")));
    assert.deepEqual(channelModes(t.home), CHANNEL_MODES, "the app uid can traverse and use the channel exactly as after `updater init`");
    assert.ok(t.calls().includes(`pull --quiet ${APP_V1}`));
    assert.match(t.calls(), /up -d --no-build --pull never/);
  } finally {
    t.cleanup();
  }
});

test("re-running keeps env, token, data, and the updater-owned app pin while refreshing the updater", () => {
  const t = setup();
  try {
    assert.equal(t.run([]).status, 0);
    writeFileSync(join(t.home, "data", "brain.db"), "user vault");
    writeFileSync(join(t.home, ".env"), `${readFileSync(join(t.home, ".env"), "utf8")}CUSTOM_SETTING=keep\n`);
    writeFileSync(join(t.home, "pin.env"), readFileSync(join(t.home, "pin.env"), "utf8").replace(APP_V1, APP_V2)); // the updater moved the app on
    const before = { env: hash(join(t.home, ".env")), db: hash(join(t.home, "data/brain.db")) };
    t.publish(APP_V1, UPD_V2, "0.1.9"); // newer installer metadata names an older app digest: it must not win
    const result = t.run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /setup token/i, "no new token on re-run");
    assert.equal(hash(join(t.home, ".env")), before.env);
    assert.equal(hash(join(t.home, "data/brain.db")), before.db);
    const pin = readFileSync(join(t.home, "pin.env"), "utf8");
    assert.match(pin, new RegExp(`CHIBAKO_IMAGE=${APP_V2}`));
    assert.match(pin, new RegExp(`CHIBAKO_UPDATER_IMAGE=${UPD_V2}`));
    assert.doesNotMatch(pin, new RegExp(UPD_V1));
  } finally {
    t.cleanup();
  }
});

test("a Compose file the installer did not write is never overwritten, and unsafe homes are refused", () => {
  const t = setup();
  try {
    mkdirSync(t.home, { recursive: true });
    writeFileSync(join(t.home, "compose.yml"), "services: { mine: {} }\n");
    const result = t.run([]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /adopt/);
    assert.equal(readFileSync(join(t.home, "compose.yml"), "utf8"), "services: { mine: {} }\n");
    assert.notEqual(t.run([], { CHIBAKO_HOME: join(t.root, "a b") }).status, 0);
    assert.notEqual(t.run([], { CHIBAKO_HOME: `${t.root}/x/../y` }).status, 0);
  } finally {
    t.cleanup();
  }
});

function adoptFixture(t: ReturnType<typeof setup>) {
  const deploy = join(t.root, "deploy"), data = join(deploy, "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(deploy, "compose.yml"), "services:\n  app:\n    image: ${APP_IMAGE}\n");
  writeFileSync(join(deploy, ".env"), "SECRET=1\n");
  writeFileSync(join(deploy, ".release.env"), `APP_IMAGE=${APP_V1}\n`);
  writeFileSync(join(data, "brain.db"), "vault");
  const files = ["compose.yml", ".env", ".release.env", "data/brain.db"].map((name) => join(deploy, name));
  const args = ["adopt", "--compose", files[0], "--env-file", files[1], "--service", "app", "--project", "chibako",
    "--data", data, "--pin-file", files[2], "--pin-var", "APP_IMAGE", "--lock-file", join(deploy, ".deploy.lock")];
  return { deploy, data, files, args, hashes: () => files.map(hash), extra: { FAKE_PIN_VAR: "APP_IMAGE", FAKE_SERVICE: "app" } };
}

test("adopt bootstraps the managed release through the updater without touching existing files or restarting the app itself", () => {
  const t = setup();
  try {
    const a = adoptFixture(t);
    const before = a.hashes();
    t.publish(APP_V2, UPD_V1, "0.1.2"); // the newest release differs from what the old deployment runs
    assert.notEqual(t.run(a.args).status, 0, "refused without the explicit external-writer acknowledgement");
    assert.equal(existsSync(join(t.home, "updater/config.json")), false, "a refused adoption writes nothing");

    const args = [...a.args];
    args.splice(3, 0, "--env-file", a.files[2]); // explicitly listed before the deployment env file
    const result = t.run([...args, "--confirm-no-external-writers"], a.extra);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(a.hashes(), before, "existing deployment files untouched");
    const config = configSchema.parse(JSON.parse(readFileSync(join(t.home, "updater/config.json"), "utf8")));
    assert.equal(config.pinVar, "APP_IMAGE");
    assert.equal(config.lockFile, join(a.deploy, ".deploy.lock"));
    assert.deepEqual(config.envFiles, [a.files[1], a.files[2]], "the pin file is always an env file, last so its value wins");
    assert.equal(config.composeFiles.at(-1), join(t.home, "updater/chibako-updates.override.yml"), "recreates mount the channel");
    assert.match(readFileSync(join(t.home, "updater/updater.compose.yml"), "utf8"), new RegExp(`image: ${UPD_V1}`));
    assert.deepEqual(channelModes(t.home), CHANNEL_MODES);

    const calls = t.calls().split("\n");
    const at = (needle: RegExp) => calls.findIndex((call) => needle.test(call));
    const order = [at(/ config --images$/), at(new RegExp(`^pull --quiet ${UPD_V1}`)), at(/-p chibako-updater .* up -d$/), at(new RegExp(`-p chibako-updater .* exec -T updater node /usr/local/lib/chibako-updater.mjs apply ${APP_V2}$`))];
    assert.ok(order.every((index) => index >= 0) && order.every((index, i) => i === 0 || index > order[i - 1]), `bootstrap order: ${order}`);
    assert.deepEqual(calls.filter((call) => /compose -p chibako /.test(call) && / (up|down|stop|restart)\b/.test(call)), [], "the script never restarts the app; the updater does, with backup and rollback");
    assert.ok(!calls.some((call) => call.startsWith(`pull --quiet ${APP_V1}`)));
  } finally {
    t.cleanup();
  }

  const u = setup();
  try {
    const a = adoptFixture(u);
    const result = u.run([...a.args, "--prepare-only"], a.extra); console.log(result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(u.calls(), / up | exec /);
    assert.match(result.stdout, /apply /);
  } finally {
    u.cleanup();
  }
});

test("adopt refuses an unsafe topology before changing anything", () => {
  const t = setup();
  try {
    const a = adoptFixture(t);
    const go = (args: string[], extra: Record<string, string> = a.extra) => t.run([...args, "--confirm-no-external-writers"], extra);
    mkdirSync(join(t.fake), { recursive: true });
    writeFileSync(join(t.fake, "resolved"), `ghcr.io/jccd-dev/chibako@sha256:${"e".repeat(64)}`); // Compose ignores the pin
    const ignored = go(a.args);
    assert.notEqual(ignored.status, 0);
    assert.match(ignored.stderr, /does not take the image/);
    rmSync(join(t.fake, "resolved"));

    writeFileSync(a.files[2], `APP_IMAGE=${APP_V1}\nAPP_IMAGE=${APP_V2}\n`);
    assert.notEqual(go(a.args).status, 0, "a duplicated pin is ambiguous");
    writeFileSync(a.files[2], "APP_IMAGE=ghcr.io/jccd-dev/chibako:latest\n"); // a floating tag cannot be rolled back safely
    assert.notEqual(go(a.args).status, 0);
    writeFileSync(a.files[2], `APP_IMAGE=${APP_V1}\n`);
    assert.notEqual(go(a.args.map((arg) => (arg === a.data ? `${a.data}; rm -rf /` : arg))).status, 0);
    assert.equal(existsSync(join(t.home, "updater/config.json")), false);
    assert.doesNotMatch(t.calls(), / up | exec /);
  } finally {
    t.cleanup();
  }
});

test("migrate moves a source build onto the managed image on its current image and data, with the old stack restartable", () => {
  const t = setup();
  try {
    const src = join(t.root, "src"), data = join(src, "data");
    mkdirSync(data, { recursive: true });
    copyFileSync(join(process.cwd(), "docker-compose.yml"), join(src, "docker-compose.yml"));
    writeFileSync(join(src, ".env"), "SITE_NAME=My Vault\nCHIBAKO_SETUP_TOKEN=tok\nUNRELATED_SECRET=nope\n");
    writeFileSync(join(data, "brain.db"), "vault");
    writeFileSync(join(t.fake, "exists"), "");
    writeFileSync(join(t.fake, "running"), "sourcebuilt");
    t.publish(APP_V2, UPD_V1, "0.1.2");
    const dbHash = hash(join(data, "brain.db"));

    assert.notEqual(t.run(["migrate", "--from", src]).status, 0, "needs the external-writer acknowledgement");
    assert.equal(existsSync(join(t.home, "compose.yml")), false);

    const result = t.run(["migrate", "--from", src, "--confirm-no-external-writers"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(hash(join(data, "brain.db")), dbHash, "the vault is used in place");
    const env = readFileSync(join(t.home, ".env"), "utf8");
    assert.match(env, /^SITE_NAME=My Vault$/m);
    assert.match(env, /^CHIBAKO_SETUP_TOKEN=tok$/m);
    assert.match(env, new RegExp(`^CHIBAKO_DATA_VOLUME=${data}$`, "m"));
    assert.doesNotMatch(env, /UNRELATED_SECRET/);
    const config = configSchema.parse(JSON.parse(readFileSync(join(t.home, "updater/config.json"), "utf8")));
    assert.equal(config.dataDir, data, "the updater fences and snapshots the same vault that Compose mounts");
    const pin = readFileSync(join(t.home, "pin.env"), "utf8");
    assert.match(pin, /^CHIBAKO_IMAGE=chibako-rollback:[0-9a-f-]{36}$/m, "starts on the image that is running now");
    assert.deepEqual(channelModes(t.home), CHANNEL_MODES);

    const calls = t.calls().split("\n");
    const at = (needle: RegExp) => calls.findIndex((call) => needle.test(call));
    const order = [at(new RegExp(`^pull --quiet ${APP_V2}`)), at(/^tag /), at(new RegExp(`--project-directory ${src} .* down$`)), at(/-p chibako .* up -d --no-build/), at(new RegExp(`exec -T updater node /usr/local/lib/chibako-updater.mjs apply ${APP_V2}$`))];
    assert.ok(order.every((index) => index >= 0) && order.every((index, i) => i === 0 || index > order[i - 1]), `migrate order: ${order}`);
    assert.doesNotMatch(t.calls(), /pull --quiet chibako-rollback/);
    assert.doesNotMatch(t.calls(), / -v|--volumes/);

    assert.notEqual(t.run(["migrate", "--from", src, "--confirm-no-external-writers"]).status, 0, "will not run over an existing deployment");
  } finally {
    t.cleanup();
  }
});

test("uninstall stops containers but keeps data, backups, and configuration", () => {
  const t = setup();
  try {
    assert.equal(t.run([]).status, 0);
    writeFileSync(join(t.home, "data", "brain.db"), "vault");
    writeFileSync(join(t.home, "backups", "keep"), "backup");
    const result = t.run(["uninstall"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(t.calls(), / down$/m);
    assert.doesNotMatch(t.calls(), /remove-orphans| -v|--volumes/);
    for (const kept of ["data/brain.db", "backups/keep", ".env", "pin.env", "compose.yml"]) assert.ok(existsSync(join(t.home, kept)), kept);
  } finally {
    t.cleanup();
  }
});
