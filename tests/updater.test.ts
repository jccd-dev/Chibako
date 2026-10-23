import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STATUS_STALE_MS, checkRequestSchema, releaseManifestSchema, statusSchema, updateRequestSchema } from "../src/features/updates/protocol";
import { writeFileAtomic } from "../updater/files";
import { writePin } from "../updater/pin";
import { acquireLock } from "../updater/lock";
import { Updater } from "../updater/updater";
import { NEW_DIGEST, NEW_REF, OLD_REF, makeFixture, manifest } from "./updater-fixture";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function makeUpdater(fixture: ReturnType<typeof makeFixture>) {
  return new Updater(fixture.config, { manifest: async () => manifest, log: () => {}, sleep: async () => {} });
}

function sendRequest(fixture: ReturnType<typeof makeFixture>, id = REQUEST_ID, version = "0.1.2", extra: Record<string, unknown> = {}) {
  const inbox = join(fixture.dirs.control, "channel", "in");
  writeFileSync(join(inbox, `request-${id}.json`), JSON.stringify({ v: 1, id, action: "update", version, ...extra }));
}

async function prepared() {
  const fixture = makeFixture();
  const updater = makeUpdater(fixture);
  await updater.check(); // creates channel dirs and publishes the first status
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(fixture.dirs.control, "channel", "in"), { recursive: true });
  return { fixture, updater };
}

function runUpdater(fixture: ReturnType<typeof makeFixture>, ...args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", "updater/main.ts", ...args], {
    env: { ...fixture.env, CHIBAKO_UPDATER_CONFIG: fixture.configFile }, stdio: "ignore",
  });
  return new Promise<number | null>((resolve) => child.on("close", (c, signal) => resolve(c ?? (signal ? -1 : null))));
}

const status = (fixture: ReturnType<typeof makeFixture>) =>
  statusSchema.parse(JSON.parse(readFileSync(join(fixture.dirs.control, "channel", "out", "status.json"), "utf8")));

test("daemon heartbeats stay fresh during slow operations without rewriting state, and stop on shutdown", { timeout: 10_000 }, async (t) => {
  const { fixture } = await prepared();
  const controller = new AbortController();
  const pulling = Promise.withResolvers<void>();
  const pulled = Promise.withResolvers<void>();
  const stopping = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  let now = 1_000_000;
  const logs: string[] = [];
  const updater = new Updater(fixture.config, {
    manifest: async () => manifest, now: () => now, log: (message) => logs.push(message),
    sleep: async () => { controller.abort(); },
  });
  const pull = updater.ctx.docker.pull.bind(updater.ctx.docker);
  t.mock.method(updater.ctx.docker, "pull", async (ref: string) => {
    pulling.resolve();
    await pulled.promise;
    await pull(ref);
  });
  const stop = updater.ctx.docker.stop.bind(updater.ctx.docker);
  t.mock.method(updater.ctx.docker, "stop", async () => {
    stopping.resolve();
    await stopped.promise;
    await stop();
  });
  t.mock.timers.enable({ apis: ["setInterval"] });
  const elapse = () => { now += 20_000; t.mock.timers.tick(20_000); };
  sendRequest(fixture);
  const running = updater.run(controller.signal);
  try {
    await pulling.promise;
    const stateFile = join(fixture.dirs.control, "state.json");
    const originalState = readFileSync(stateFile, "utf8");
    const firstHeartbeat = status(fixture).heartbeatAt;
    for (let elapsed = 0; elapsed <= STATUS_STALE_MS; elapsed += 20_000) {
      elapse();
      assert.equal(status(fixture).heartbeatAt, now, "pending pull still publishes a fresh heartbeat");
      assert.equal(status(fixture).operation?.phase, "pulling");
    }
    assert.ok(now - firstHeartbeat > STATUS_STALE_MS, "pull remains pending beyond the stale threshold");
    assert.equal(readFileSync(stateFile, "utf8"), originalState, "heartbeat never saves authoritative state");
    assert.equal(await acquireLock(fixture.config.lockFile), null, "operation still owns its lock");

    const statusFile = join(fixture.dirs.control, "channel", "out", "status.json");
    const lastStatus = readFileSync(statusFile, "utf8");
    writeFileSync(stateFile, "{broken");
    assert.doesNotThrow(elapse, "malformed state is contained by the heartbeat callback");
    assert.equal(readFileSync(statusFile, "utf8"), lastStatus, "malformed state never replaces valid status");
    writeFileSync(stateFile, originalState);

    rmSync(statusFile);
    mkdirSync(statusFile); // force an actual atomic status write failure
    assert.doesNotThrow(elapse, "status write failures do not escape the timer");
    rmSync(statusFile, { recursive: true });
    elapse();
    assert.equal(status(fixture).heartbeatAt, now, "publishing recovers after a write failure");
    assert.equal(logs.filter((message) => message.startsWith("heartbeat failed:")).length, 2);

    pulled.resolve();
    await stopping.promise;
    elapse();
    assert.equal(status(fixture).operation?.phase, "quiescing", "heartbeat reads the latest persisted phase");
    controller.abort();
    elapse();
    assert.equal(status(fixture).heartbeatAt, now, "shutdown keeps the in-flight operation visible until it finishes");
    stopped.resolve();
    await running;
    assert.equal(status(fixture).operation?.phase, "succeeded");
    const finalStatus = readFileSync(statusFile, "utf8");
    elapse();
    assert.equal(readFileSync(statusFile, "utf8"), finalStatus, "no heartbeat remains after run returns");
    const lock = await acquireLock(fixture.config.lockFile);
    assert.ok(lock, "shutdown releases the operation lock");
    await lock.release();
  } finally {
    controller.abort();
    pulled.resolve();
    stopped.resolve();
    await running;
    fixture.cleanup();
  }
});

test("daemon clears its heartbeat when startup fails", async (t) => {
  const fixture = makeFixture();
  const updater = makeUpdater(fixture);
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(updater, "check", async () => { throw new Error("startup failed"); });
  const publish = t.mock.method(updater, "publish", () => {});
  try {
    await assert.rejects(updater.run(new AbortController().signal), /startup failed/);
    t.mock.timers.tick(40_000);
    assert.equal(publish.mock.callCount(), 0, "failed run leaves no timer behind");
  } finally {
    fixture.cleanup();
  }
});

// Test decision: add, integration — the updater has host privilege and owns data; these cover the
// ordering, rollback, and recovery contracts that could break silently.

test("a requested update pulls the selected digest while the old pin is still active, snapshots the WAL, then commits", async () => {
  const { fixture, updater } = await prepared();
  try {
    sendRequest(fixture);
    await updater.tick();

    const calls = fixture.calls();
    assert.ok(calls.includes(`pull-pin ${OLD_REF}`), "pull happened while the previous pin was still in place");
    assert.ok(calls.some((call) => call === `pull --quiet ${NEW_REF}`), "pulled the exact selected digest");
    assert.equal(fixture.pin(), NEW_REF);
    assert.match(readFileSync(fixture.pinFile, "utf8"), /^KEEP_ME=1$/m, "unrelated env lines are preserved");
    assert.equal(fixture.marker(), false, "writes are reopened only after validation");
    const snapshots = readdirSync(fixture.dirs.backups);
    assert.equal(snapshots.length, 1);
    assert.deepEqual(fixture.notes(join(fixture.dirs.backups, snapshots[0], "brain.db")), ["before-update", "only-in-wal"]);
    assert.equal(status(fixture).operation?.phase, "succeeded");
  } finally {
    fixture.cleanup();
  }
});

test("an unhealthy new version restores the matching backup and previous pin without losing the failed state", async () => {
  const { fixture, updater } = await prepared();
  try {
    fixture.knob("unhealthy", NEW_REF);
    fixture.knob("migrate-on-up", NEW_REF); // the new image migrates and writes before failing its health gate
    sendRequest(fixture);
    await updater.tick();

    const op = status(fixture).operation!;
    assert.equal(op.phase, "rolled_back");
    assert.match(op.error ?? "", /healthy/);
    assert.equal(fixture.pin(), OLD_REF);
    assert.deepEqual(fixture.notes(), ["before-update", "only-in-wal"], "database is back to the pre-update snapshot");
    const dir = readdirSync(fixture.dirs.backups)[0];
    assert.deepEqual(fixture.notes(join(fixture.dirs.backups, dir, "failed", "brain.db")), ["before-update", "only-in-wal", "written-by-new-image"], "failed state quarantined, not deleted");
    assert.equal(fixture.marker(), false);
    assert.equal(readFileSync(join(fixture.dirs.fake, "running"), "utf8").trim(), OLD_REF, "old version serves again");
  } finally {
    fixture.cleanup();
  }
});

test("a failed pull changes nothing: no stop, no pin change, no maintenance window", async () => {
  const { fixture, updater } = await prepared();
  try {
    fixture.knob("fail-pull", "1");
    sendRequest(fixture);
    await updater.tick();
    assert.equal(status(fixture).operation?.phase, "failed");
    assert.equal(fixture.pin(), OLD_REF);
    assert.equal(fixture.marker(), false);
    assert.ok(!fixture.calls().some((call) => call.includes(" stop ")));
  } finally {
    fixture.cleanup();
  }
});

test("a process killed mid-start resumes from persisted state, and a bad target is then rolled back with its data", async () => {
  for (const outcome of ["succeeds", "rolls-back"] as const) {
    const { fixture, updater } = await prepared();
    try {
      fixture.knob("crash-on", "up"); // fake docker SIGKILLs the updater when it tries to start the new version
      const child = spawn(process.execPath, ["--import", "tsx", "updater/main.ts", "apply", NEW_REF], {
        env: { ...fixture.env, CHIBAKO_UPDATER_CONFIG: fixture.configFile }, stdio: "ignore",
      });
      const code = await new Promise<number | null>((resolve) => child.on("close", (c, s) => resolve(c ?? (s ? -1 : null))));
      assert.notEqual(code, 0, "updater process died mid-operation");
      assert.equal(fixture.marker(), true, "writers stay fenced while the operation is incomplete");
      assert.equal(fixture.pin(), NEW_REF);

      fixture.knob("crash-on", "none");
      if (outcome === "rolls-back") {
        fixture.knob("unhealthy", NEW_REF);
        fixture.knob("migrate-on-up", NEW_REF);
      }
      await updater.tick(); // recovery, as the restarted daemon would do
      const phase = status(fixture).operation?.phase;
      if (outcome === "succeeds") {
        assert.equal(phase, "succeeded");
        assert.equal(fixture.pin(), NEW_REF);
      } else {
        assert.equal(phase, "rolled_back");
        assert.equal(fixture.pin(), OLD_REF);
        assert.deepEqual(fixture.notes(), ["before-update", "only-in-wal"]);
      }
      assert.equal(fixture.marker(), false);
    } finally {
      fixture.cleanup();
    }
  }
});

test("request intake rejects forged, oversized, linked, replayed, and stale requests without side effects", async () => {
  const { fixture, updater } = await prepared();
  try {
    const inbox = join(fixture.dirs.control, "channel", "in");
    writeFileSync(join(inbox, "request-bad.json"), "{}");
    sendRequest(fixture, "22222222-2222-4222-8222-222222222222", "0.1.2", { image: "evil/repo" }); // extra field => strict reject
    sendRequest(fixture, "33333333-3333-4333-8333-333333333333", "9.9.9"); // not what the updater found
    writeFileSync(join(fixture.root, "target"), JSON.stringify({ v: 1, id: "44444444-4444-4444-8444-444444444444", action: "update", version: "0.1.2" }));
    symlinkSync(join(fixture.root, "target"), join(inbox, "request-44444444-4444-4444-8444-444444444444.json"));
    writeFileSync(join(inbox, "request-55555555-5555-4555-8555-555555555555.json"), " ".repeat(5000));
    await updater.tick();
    assert.equal(status(fixture).operation, null, "no operation from invalid requests");
    assert.equal(fixture.pin(), OLD_REF);
    assert.deepEqual(readdirSync(inbox), [], "every request file is consumed");
    assert.deepEqual(fixture.calls().filter((call) => call.startsWith("pull ")), []);

    sendRequest(fixture);
    await updater.tick();
    assert.equal(status(fixture).operation?.phase, "succeeded");
    const pulls = fixture.calls().filter((call) => call.startsWith("pull --quiet")).length;
    sendRequest(fixture); // replay of an already-consumed id
    await updater.tick();
    assert.equal(fixture.calls().filter((call) => call.startsWith("pull --quiet")).length, pulls, "replayed id starts nothing");
  } finally {
    fixture.cleanup();
  }
});

test("release discovery runs every 3 hours, and a manual check refetches without installing or replaying", async () => {
  const { fixture } = await prepared();
  const controller = new AbortController();
  let now = 1_000_000;
  let fetches = 0;
  const seenAfterSleep: number[] = [];
  const updater = new Updater(fixture.config, {
    manifest: async () => { fetches += 1; return manifest; }, now: () => now, log: () => {},
    sleep: async () => {
      seenAfterSleep.push(fetches);
      now += 60 * 60_000;
      if (seenAfterSleep.length === 4) controller.abort();
    },
  });
  try {
    await updater.run(controller.signal);
    // Startup check, nothing at +1h/+2h, the next at +3h.
    assert.deepEqual(seenAfterSleep, [1, 1, 1, 2]);

    const checkId = "66666666-6666-4666-8666-666666666666";
    const inbox = join(fixture.dirs.control, "channel", "in");
    const sendCheck = () => writeFileSync(join(inbox, `request-${checkId}.json`), JSON.stringify({ v: 1, id: checkId, action: "check" }));
    const pulls = () => fixture.calls().filter((call) => call.startsWith("pull ")).length;
    assert.equal(status(fixture).checkAck ?? null, null);
    sendCheck();
    await updater.tick();
    assert.equal(fetches, 3, "manual check fetched the manifest");
    assert.equal(status(fixture).checkAck, checkId);
    assert.equal(status(fixture).operation, null, "a check never starts an operation");
    assert.equal(pulls(), 0);
    assert.equal(fixture.pin(), OLD_REF);
    assert.deepEqual(readdirSync(inbox), []);
    sendCheck(); // replay
    await updater.tick();
    assert.equal(fetches, 3, "a replayed check id fetches nothing");
    writeFileSync(join(inbox, "request-77777777-7777-4777-8777-777777777777.json"), JSON.stringify({ v: 1, id: "77777777-7777-4777-8777-777777777777", action: "check", version: "0.1.2" }));
    await updater.tick();
    assert.equal(fetches, 3, "a check with extra fields is rejected");
  } finally {
    fixture.cleanup();
  }
});

test("only one operation runs at a time across processes: a held lock leaves the request queued", async () => {
  const { fixture, updater } = await prepared();
  try {
    const lock = await acquireLock(fixture.config.lockFile);
    assert.ok(lock);
    sendRequest(fixture);
    await updater.tick();
    assert.equal(fixture.pin(), OLD_REF);
    assert.ok(existsSync(join(fixture.dirs.control, "channel", "in", `request-${REQUEST_ID}.json`)), "request waits");
    assert.equal(await acquireLock(fixture.config.lockFile), null, "a second holder is refused");
    await lock.release();
    await updater.tick();
    assert.equal(fixture.pin(), NEW_REF);
  } finally {
    fixture.cleanup();
  }
});

test("operator apply refuses foreign repositories and malformed digests before touching Docker", async () => {
  const { fixture } = await prepared();
  try {
    const before = fixture.calls().length;
    for (const ref of ["evil.example/chibako@" + NEW_DIGEST, "ghcr.io/jccd-dev/chibako:latest", "ghcr.io/jccd-dev/chibako@sha256:123"]) {
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn(process.execPath, ["--import", "tsx", "updater/main.ts", "apply", ref], { env: { ...fixture.env, CHIBAKO_UPDATER_CONFIG: fixture.configFile }, stdio: "ignore" });
        child.on("close", resolve);
      });
      assert.equal(code, 64);
    }
    assert.equal(fixture.calls().length, before);
  } finally {
    fixture.cleanup();
  }
});

test("release manifests and requests are validated strictly", () => {
  assert.ok(releaseManifestSchema.safeParse(manifest).success);
  for (const bad of [
    { ...manifest, image: "ghcr.io/evil/chibako" },
    { ...manifest, digest: "sha256:123" },
    { ...manifest, version: "1.2" },
    { ...manifest, url: "https://evil.example/x" },
    { ...manifest, extra: true },
  ]) assert.equal(releaseManifestSchema.safeParse(bad).success, false);
  assert.equal(updateRequestSchema.safeParse({ v: 1, id: REQUEST_ID, action: "update", version: "0.1.2; rm -rf /" }).success, false);
  assert.equal(checkRequestSchema.safeParse({ v: 1, id: REQUEST_ID, action: "check", version: "0.1.2" }).success, false);
  assert.equal(updateRequestSchema.safeParse({ v: 1, id: REQUEST_ID, action: "update", version: "0.1.2", digest: NEW_DIGEST }).success, false);
});

test("the pin writer only edits its own line and refuses unexpected references and links", () => {
  const fixture = makeFixture();
  try {
    writePin(fixture.pinFile, "CHIBAKO_IMAGE", NEW_REF);
    assert.equal(readFileSync(fixture.pinFile, "utf8"), `KEEP_ME=1\nCHIBAKO_IMAGE=${NEW_REF}\n`);
    assert.throws(() => writePin(fixture.pinFile, "CHIBAKO_IMAGE", "ghcr.io/evil/x@" + NEW_DIGEST));
    assert.throws(() => writePin(fixture.pinFile, "CHIBAKO_IMAGE", `${NEW_REF}\nINJECTED=1`));
    const link = join(fixture.root, "link.env");
    symlinkSync(fixture.pinFile, link);
    assert.throws(() => writePin(link, "CHIBAKO_IMAGE", NEW_REF));
  } finally {
    fixture.cleanup();
  }
});

test("init prepares the channel layout idempotently without overwriting an existing config", async () => {
  const { mkdtempSync, realpathSync, statSync, readFileSync: read, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { initLayout } = await import("../updater/init");
  const { configSchema } = await import("../updater/config");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "chibako-init-")));
  try {
    const dataDir = join(home, "source-vault");
    initLayout(home, dataDir);
    const config = configSchema.parse(JSON.parse(read(join(home, "updater/config.json"), "utf8")));
    assert.equal(config.dataDir, dataDir, "Docker-only initialization keeps the configured vault location");
    assert.equal(statSync(join(home, "updater/channel/in")).mode & 0o1777, 0o1777);
    write(join(home, "updater/config.json"), '{"customised":true}');
    initLayout(home);
    assert.equal(read(join(home, "updater/config.json"), "utf8"), '{"customised":true}');
  } finally {
    const { rmSync } = await import("node:fs");
    rmSync(home, { recursive: true, force: true });
  }
});

// Test decision: add, integration — each case below is a data-loss or privilege path found in review:
// fence removed after a failed rollback, state overwritten by an idle daemon, root writing through
// app-planted links, and a pin that Compose does not actually honour.

test("a failed rollback keeps writes fenced and refuses new updates across a daemon restart until recovery", async () => {
  const { fixture, updater } = await prepared();
  try {
    fixture.knob("unhealthy", NEW_REF);
    fixture.knob("migrate-on-up", NEW_REF);
    fixture.knob("fail-up", OLD_REF); // the previous version cannot be started again
    sendRequest(fixture);
    await updater.tick();
    assert.equal(status(fixture).operation?.phase, "needs_attention");
    assert.equal(fixture.marker(), true, "the fence survives the failed rollback");

    const restarted = makeUpdater(fixture);
    await restarted.run(AbortSignal.abort()); // startup recovery, as after a container restart
    assert.equal(fixture.marker(), true, "startup cleanup must not reopen writes");

    fixture.knob("fail-up", "none");
    const pulls = fixture.calls().filter((call) => call.startsWith("pull --quiet")).length;
    sendRequest(fixture, "66666666-6666-4666-8666-666666666666");
    await restarted.tick();
    assert.equal(fixture.calls().filter((call) => call.startsWith("pull --quiet")).length, pulls, "no new update while attention is needed");
    assert.equal(status(fixture).operation?.phase, "needs_attention");
    assert.equal(fixture.marker(), true);

    assert.equal(await runUpdater(fixture, "recover"), 0);
    assert.equal(status(fixture).operation?.phase, "rolled_back");
    assert.equal(fixture.marker(), false, "writes reopen only after a verified rollback");
    assert.deepEqual(fixture.notes(), ["before-update", "only-in-wal"]);
    assert.equal(fixture.pin(), OLD_REF);
  } finally {
    fixture.cleanup();
  }
});

test("an idle daemon sweeps junk without touching state an operator apply just committed", async () => {
  const { fixture, updater } = await prepared();
  try {
    assert.equal(await runUpdater(fixture, "apply", NEW_REF), 0);
    const stateFile = join(fixture.dirs.control, "state.json");
    const committed = readFileSync(stateFile, "utf8");
    const inbox = join(fixture.dirs.control, "channel", "in");
    writeFileSync(join(inbox, "junk.txt"), "x");
    writeFileSync(join(inbox, ".tmp-stale"), "x");
    utimesSync(join(inbox, ".tmp-stale"), 1, 1);
    const saves: number[] = [];
    const save = updater.ctx.store.save.bind(updater.ctx.store);
    updater.ctx.store.save = (state) => { saves.push(1); save(state); };
    const lock = await acquireLock(fixture.config.lockFile); // even a held lock must not matter to an idle sweep
    await updater.tick();
    await lock?.release();
    assert.deepEqual(saves, [], "an idle tick performs no state write outside the lock");
    assert.deepEqual(readdirSync(inbox), [], "junk and stale temp files are swept");
    assert.equal(readFileSync(stateFile, "utf8"), committed, "idle ticks never rewrite authoritative state");
    assert.equal(status(fixture).operation?.phase, "succeeded");
  } finally {
    fixture.cleanup();
  }
});

test("links planted by the app inside the vault are never written through, and a linked database is refused", async () => {
  const { fixture, updater } = await prepared();
  try {
    const sentinel = join(fixture.root, "private.txt");
    writeFileSync(sentinel, "private");
    const marker = join(fixture.dirs.data, ".chibako-maintenance");
    symlinkSync(sentinel, `${marker}.tmp-${process.pid}`); // names an older updater used
    symlinkSync(sentinel, join(fixture.dirs.data, "brain.db.restoring"));
    fixture.knob("unhealthy", NEW_REF);
    fixture.knob("migrate-on-up", NEW_REF);
    sendRequest(fixture);
    await updater.tick();
    assert.equal(status(fixture).operation?.phase, "rolled_back", status(fixture).operation?.error ?? "");
    assert.equal(readFileSync(sentinel, "utf8"), "private", "nothing was written through a planted link");
    assert.deepEqual(fixture.notes(), ["before-update", "only-in-wal"]);
    assert.equal(lstatSync(join(fixture.dirs.data, "brain.db")).isFile(), true);
  } finally {
    fixture.cleanup();
  }

  for (const plant of [symlinkSync, linkSync]) {
    const second = await prepared();
    try {
      const sentinel = join(second.fixture.root, "private.db");
      writeFileSync(sentinel, "private");
      for (const name of ["brain.db", "brain.db-wal", "brain.db-shm"]) rmSync(join(second.fixture.dirs.data, name), { force: true });
      plant(sentinel, join(second.fixture.dirs.data, "brain.db"));
      sendRequest(second.fixture);
      await second.updater.tick();
      const op = status(second.fixture).operation!;
      assert.equal(op.phase, "rolled_back");
      assert.match(op.error ?? "", /link or special file/);
      assert.equal(readFileSync(sentinel, "utf8"), "private");
      assert.deepEqual(readdirSync(second.fixture.dirs.backups).flatMap((dir) => readdirSync(join(second.fixture.dirs.backups, dir))), [], "no snapshot of a linked file");
    } finally {
      second.fixture.cleanup();
    }
  }
});

test("atomic writes use unpredictable exclusive temp files and replace a link instead of following it", () => {
  const fixture = makeFixture();
  try {
    const sentinel = join(fixture.root, "private.txt");
    writeFileSync(sentinel, "private");
    const target = join(fixture.root, "out.json");
    symlinkSync(sentinel, `${target}.tmp-${process.pid}`);
    symlinkSync(sentinel, target);
    writeFileAtomic(target, "new");
    assert.equal(readFileSync(sentinel, "utf8"), "private");
    assert.equal(lstatSync(target).isFile(), true);
    assert.equal(readFileSync(target, "utf8"), "new");
    assert.deepEqual(readdirSync(fixture.root).filter((name) => name.startsWith("out.json.tmp-")), [`out.json.tmp-${process.pid}`], "no temp file left behind");
  } finally {
    fixture.cleanup();
  }
});

test("an update whose pin Compose does not honour is refused before anything stops, or rolled back before the new image starts", async () => {
  const foreign = `ghcr.io/jccd-dev/chibako@sha256:${"e".repeat(64)}`;
  const early = await prepared();
  try {
    early.fixture.knob("resolved", foreign); // Compose ignores the pin file for this service
    sendRequest(early.fixture);
    await early.updater.tick();
    assert.match(status(early.fixture).checkError ?? "", /not the CHIBAKO_IMAGE pin/);
    assert.equal(status(early.fixture).operation, null);
    assert.ok(!early.fixture.calls().some((call) => call.includes(" stop ") || call.startsWith("pull --quiet")));
    assert.equal(early.fixture.marker(), false);
  } finally {
    early.fixture.cleanup();
  }

  const late = await prepared();
  try {
    sendRequest(late.fixture);
    late.fixture.knob("resolved", OLD_REF); // the preflight passes, but the new pin would be ignored
    await late.updater.tick();
    const op = status(late.fixture).operation!;
    assert.equal(op.phase, "rolled_back");
    assert.match(op.error ?? "", /not the CHIBAKO_IMAGE pin/);
    assert.ok(!late.fixture.calls().includes(`up-pin ${NEW_REF}`), "the new image was never started");
    assert.deepEqual(late.fixture.notes(), ["before-update", "only-in-wal"]);
    assert.equal(late.fixture.marker(), false);
  } finally {
    late.fixture.cleanup();
  }
});
