import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UpdaterConfig } from "./config";
import type { Docker } from "./docker";
import { readBounded, writeFileAtomic } from "./files";
import { isValidPin, readPin, writePin } from "./pin";
import { assertSpace, createSnapshot, quarantineVault, restoreSnapshot } from "./snapshot";
import type { Operation, StateStore } from "./state";
import { IMAGE_REPOSITORY, TERMINAL_PHASES, type OperationPhase } from "../src/features/updates/protocol";

export interface Context {
  config: UpdaterConfig;
  docker: Docker;
  store: StateStore;
  now(): number;
  log(message: string): void;
  publish(): void;
}

export function markerPath(config: UpdaterConfig): string {
  return path.join(config.dataDir, ".chibako-maintenance");
}

const isTerminal = (phase: OperationPhase) => TERMINAL_PHASES.includes(phase);
const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

function update(ctx: Context, patch: Partial<Operation>): Operation {
  const state = ctx.store.load();
  if (!state.operation) throw new Error("No operation in progress");
  state.operation = { ...state.operation, ...patch, updatedAt: ctx.now() };
  ctx.store.save(state);
  ctx.publish();
  return state.operation;
}

function removeOwnMarker(ctx: Context, op: Operation): void {
  const file = markerPath(ctx.config);
  if (readBounded(file, 64) === op.id) fs.rmSync(file); // bounded, no-follow read: the vault directory is app-writable
}

/** Records a new operation. The caller holds the operation lock and has checked nothing is active. */
export async function beginOperation(ctx: Context, target: { version: string; digest: string }): Promise<Operation> {
  const state = ctx.store.load();
  if (state.operation && !isTerminal(state.operation.phase)) throw new Error("An update is already in progress.");
  if (state.operation?.phase === "needs_attention") throw new Error("A previous update needs attention and writes are still paused. Run the updater's recover command or restore the backup first.");
  const id = randomUUID();
  const configured = readPin(ctx.config.pinFile, ctx.config.pinVar);
  if (!configured || !isValidPin(configured)) throw new Error(`${ctx.config.pinFile} must pin ${ctx.config.pinVar} to a Chibako release; the update was not started.`);
  await ctx.docker.assertResolvedImage(configured); // before anything is stopped or tagged
  const running = await ctx.docker.runningImage(`chibako-rollback:${id}`);
  const previousPin = running?.pin ?? configured;
  const operation: Operation = {
    id, phase: "pulling", from: running?.version ?? null, to: target.version,
    targetRef: `${IMAGE_REPOSITORY}@${target.digest}`, previousPin,
    restoreData: false, quarantined: false, restored: false, snapshot: null,
    startedAt: ctx.now(), updatedAt: ctx.now(), error: null,
  };
  state.operation = operation;
  ctx.store.save(state);
  ctx.publish();
  return operation;
}

function snapshotDir(ctx: Context, op: Operation): string {
  return path.join(ctx.config.backupDir, op.id);
}

async function runPhase(ctx: Context, op: Operation): Promise<void> {
  const { config, docker } = ctx;
  switch (op.phase) {
    case "pulling": {
      assertSpace(config.dataDir, config.backupDir);
      await docker.pull(op.targetRef);
      const label = await docker.imageVersion(op.targetRef);
      if (label !== op.to) throw new Error(`The downloaded image is version ${label ?? "unknown"}, not ${op.to}.`);
      update(ctx, { phase: "quiescing" });
      return;
    }
    case "quiescing": {
      // The marker fences every writer that honours it (HTTP and local stdio MCP) before and after the stop.
      writeFileAtomic(markerPath(config), op.id, 0o644);
      await docker.stop();
      update(ctx, { phase: "snapshotting" });
      return;
    }
    case "snapshotting": {
      await docker.stop();
      const snapshot = createSnapshot(config.dataDir, snapshotDir(ctx, op));
      update(ctx, { phase: "switching", snapshot, restoreData: true });
      return;
    }
    case "switching": {
      writePin(config.pinFile, config.pinVar, op.targetRef);
      await docker.assertResolvedImage(op.targetRef);
      update(ctx, { phase: "starting" });
      return;
    }
    case "starting": {
      await docker.up();
      await docker.waitHealthy(op.targetRef);
      update(ctx, { phase: "validating" });
      return;
    }
    case "validating": {
      // Health already ran the migrations. Commit first, then reopen writes, so a crash
      // here can never roll back a database that has accepted new data.
      await docker.waitHealthy(op.targetRef);
      const done = update(ctx, { phase: "succeeded" });
      removeOwnMarker(ctx, done);
      return;
    }
    case "rolling_back": {
      await rollback(ctx, op);
      return;
    }
  }
}

async function rollback(ctx: Context, op: Operation): Promise<void> {
  const { config, docker } = ctx;
  if (!op.previousPin) throw new Error("No previous version is recorded.");
  let current = op;
  if (current.restoreData) {
    await docker.stop();
    if (!current.quarantined) {
      quarantineVault(config.dataDir, path.join(snapshotDir(ctx, current), "failed"));
      current = update(ctx, { quarantined: true });
    }
    if (!current.restored) {
      if (!current.snapshot) throw new Error("No backup was recorded for this update.");
      restoreSnapshot(config.dataDir, snapshotDir(ctx, current), current.snapshot);
      current = update(ctx, { restored: true });
    }
  }
  writePin(config.pinFile, config.pinVar, current.previousPin!);
  await docker.assertResolvedImage(current.previousPin!);
  await docker.up();
  await docker.waitHealthy(current.previousPin!);
  update(ctx, { phase: "rolled_back" });
  removeOwnMarker(ctx, current);
}

/** Drives the persisted operation to a terminal phase; safe to call again after a crash. */
export async function advance(ctx: Context): Promise<Operation | null> {
  for (;;) {
    const op = ctx.store.load().operation;
    if (!op) return null;
    if (isTerminal(op.phase)) {
      // Writes reopen only after a verified new version or a completed rollback; needs_attention keeps the fence.
      if (op.phase !== "needs_attention") removeOwnMarker(ctx, op);
      if (op.phase === "succeeded") pruneSnapshots(ctx, op);
      return op;
    }
    ctx.log(`operation ${op.id} phase ${op.phase}`);
    try {
      await runPhase(ctx, op);
    } catch (error) {
      const message = failureText(error);
      ctx.log(`operation ${op.id} failed in ${op.phase}: ${message}`);
      if (op.phase === "pulling") update(ctx, { phase: "failed", error: message });
      else if (op.phase === "rolling_back") update(ctx, { phase: "needs_attention", error: `Rollback failed: ${message}. Writes stay paused; see the backup in ${snapshotDir(ctx, op)}.` });
      else update(ctx, { phase: "rolling_back", error: message });
    }
  }
}

/** Operator retry of a failed rollback; persisted progress flags make it resume where it stopped. */
export async function recoverOperation(ctx: Context): Promise<Operation | null> {
  if (ctx.store.load().operation?.phase !== "needs_attention") throw new Error("Nothing needs recovery.");
  update(ctx, { phase: "rolling_back", error: null });
  return advance(ctx);
}

/** Keep only the newest successful snapshot; quarantined failures are never deleted automatically. */
function pruneSnapshots(ctx: Context, keep: Operation): void {
  for (const entry of fs.readdirSync(ctx.config.backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep.id || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const dir = path.join(ctx.config.backupDir, entry.name);
    if (!fs.existsSync(path.join(dir, "failed"))) fs.rmSync(dir, { recursive: true, force: true });
  }
}
