import fs from "node:fs";
import path from "node:path";
import { UPDATER_PROTOCOL, MAX_REQUEST_BYTES, REQUEST_FILE, TERMINAL_PHASES, compareVersions, updateRequestSchema, type ReleaseManifest, type UpdaterStatus } from "../src/features/updates/protocol";
import type { UpdaterConfig } from "./config";
import { Docker } from "./docker";
import { readBounded, writeFileAtomic } from "./files";
import { acquireLock } from "./lock";
import { advance, beginOperation, type Context } from "./operation";
import { StateStore, type UpdaterState } from "./state";

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const MAX_SCANNED = 64;

export interface UpdaterDeps {
  manifest(): Promise<ReleaseManifest>;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  log?(message: string): void;
}

/** Long-running owner of update policy: publishes status, consumes requests, runs one operation at a time. */
export class Updater {
  readonly ctx: Context;
  private latest: ReleaseManifest | null = null;
  private checkedAt: number | null = null;
  private checkError: string | null = null;
  private currentVersion: string | null = null;

  constructor(private config: UpdaterConfig, private deps: UpdaterDeps) {
    const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.ctx = {
      config,
      docker: new Docker(config, sleep),
      store: new StateStore(config.controlDir),
      now: deps.now ?? Date.now,
      log: deps.log ?? ((message) => console.log(`[updater] ${message}`)),
      publish: () => this.publish(),
    };
  }

  private get inbox() { return path.join(this.config.controlDir, "channel", "in"); }
  private get outbox() { return path.join(this.config.controlDir, "channel", "out"); }

  publish(): void {
    const op = this.ctx.store.load().operation;
    const status: UpdaterStatus = {
      v: 1, protocol: UPDATER_PROTOCOL, heartbeatAt: this.ctx.now(), checkedAt: this.checkedAt,
      currentVersion: this.currentVersion,
      latest: this.latest ? { version: this.latest.version, notes: this.latest.notes, publishedAt: this.latest.publishedAt, url: this.latest.url } : null,
      checkError: this.checkError,
      operation: op ? { id: op.id, phase: op.phase, from: op.from as string | null, to: op.to, updatedAt: op.updatedAt, error: op.error } : null,
    };
    fs.mkdirSync(this.outbox, { recursive: true });
    writeFileAtomic(path.join(this.outbox, "status.json"), JSON.stringify(status), 0o644);
  }

  /** Refresh what is running and what is available. A newer release never installs itself. */
  async check(): Promise<void> {
    this.checkedAt = this.ctx.now();
    try {
      const running = await this.ctx.docker.runningImage().catch(() => null);
      this.currentVersion = running?.version ?? null;
      const manifest = await this.deps.manifest();
      this.checkError = null;
      if (manifest.minUpdaterProtocol > UPDATER_PROTOCOL) {
        this.latest = null;
        this.checkError = "A newer updater is required. Re-run the Chibako installer to refresh it.";
      } else {
        this.latest = this.currentVersion && compareVersions(manifest.version, this.currentVersion) <= 0 ? null : manifest;
      }
    } catch (error) {
      this.checkError = "Could not check for updates.";
      this.ctx.log(`check failed: ${error instanceof Error ? error.message : error}`);
    }
    this.publish();
  }

  /**
   * Sweeps junk and abandoned temp files. With `consume`, also takes at most one valid request
   * and records every request id as seen; that is the only state write here, so callers must hold the
   * operation lock. A sweep alone never touches the authoritative state.
   */
  private scanInbox(consume: boolean): string | null {
    if (!fs.existsSync(this.inbox)) return null;
    let state: UpdaterState | null = null;
    let accepted: string | null = null;
    for (const name of fs.readdirSync(this.inbox).slice(0, MAX_SCANNED)) {
      const file = path.join(this.inbox, name);
      if (name.startsWith(".tmp-")) {
        // Abandoned partial write from a crashed app.
        try { if (this.ctx.now() - fs.lstatSync(file).mtimeMs > 10 * 60_000) fs.rmSync(file); } catch { /* raced */ }
        continue;
      }
      if (!REQUEST_FILE.test(name)) { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } continue; }
      if (!consume) continue;
      const text = readBounded(file, MAX_REQUEST_BYTES);
      fs.rmSync(file, { force: true });
      if (text === null) continue;
      let request;
      try { request = updateRequestSchema.parse(JSON.parse(text)); } catch { continue; }
      state ??= this.ctx.store.load();
      if (name !== `request-${request.id}.json` || state.seen.includes(request.id)) continue; // replay or mismatch
      state.seen = [...state.seen, request.id].slice(-64);
      if (!accepted) accepted = request.version;
    }
    if (state) this.ctx.store.save(state);
    return accepted;
  }

  private hasRequest(): boolean {
    return fs.existsSync(this.inbox) && fs.readdirSync(this.inbox).some((name) => REQUEST_FILE.test(name));
  }

  private isPending(): boolean {
    const op = this.ctx.store.load().operation;
    return !!op && !TERMINAL_PHASES.includes(op.phase);
  }

  /** One scheduling step; returns after at most one operation. */
  async tick(): Promise<void> {
    if (!this.isPending() && !this.hasRequest()) { this.scanInbox(false); return; }
    const lock = await acquireLock(this.config.lockFile);
    if (!lock) { this.ctx.log("another deployment holds the lock"); return; } // requests stay queued
    try {
      if (!this.isPending()) { // re-read under the lock: an operator apply may have finished meanwhile
        const version = this.scanInbox(true);
        if (!version) return;
        const manifest = await this.deps.manifest();
        if (manifest.version !== version || manifest.minUpdaterProtocol > UPDATER_PROTOCOL) {
          this.checkError = `Version ${version} is no longer the available update.`;
          return this.publish();
        }
        const running = await this.ctx.docker.runningImage().catch(() => null);
        if (running?.version && compareVersions(manifest.version, running.version) <= 0) return;
        await beginOperation(this.ctx, { version: manifest.version, digest: manifest.digest });
      }
      await advance(this.ctx);
      await this.check();
    } catch (error) {
      this.ctx.log(`operation could not start: ${error instanceof Error ? error.message : error}`);
      this.checkError = error instanceof Error ? error.message.slice(0, 280) : "The update could not start.";
      this.publish();
    } finally {
      await lock.release();
    }
  }

  /** Finish an interrupted marker cleanup after a restart, under the same lock as every other state change. */
  private async settle(): Promise<void> {
    const lock = await acquireLock(this.config.lockFile);
    if (!lock) return;
    try {
      const settled = this.ctx.store.load().operation;
      if (settled && TERMINAL_PHASES.includes(settled.phase)) await advance(this.ctx);
    } finally {
      await lock.release();
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    fs.mkdirSync(this.inbox, { recursive: true, mode: 0o1777 });
    fs.chmodSync(this.inbox, 0o1777);
    // Read current state only: operations and operator recovery remain the sole locked state writers.
    const heartbeat = setInterval(() => {
      try {
        this.publish();
      } catch (error) {
        this.ctx.log(`heartbeat failed: ${error instanceof Error ? error.message : error}`);
      }
    }, 20_000);
    try {
      await this.settle();
      await this.check();
      let nextCheck = this.ctx.now() + CHECK_INTERVAL_MS;
      while (!signal.aborted) {
        await this.tick();
        if (this.ctx.now() >= nextCheck) { await this.check(); nextCheck = this.ctx.now() + CHECK_INTERVAL_MS; }
        await sleep(2000);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
