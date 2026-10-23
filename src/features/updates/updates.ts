import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_REQUEST_BYTES, REQUEST_FILE, STATUS_STALE_MS, TERMINAL_PHASES, UPDATER_PROTOCOL,
  compareVersions, statusSchema, versionSchema, type UpdateView, type UpdaterStatus,
} from "./protocol";

/**
 * App side of the update channel. The app only reads a display status the
 * updater publishes (read-only mount) and drops a bounded request file; the
 * updater re-derives the target from the signed-off release manifest itself.
 */

export class UpdateError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
    this.name = "UpdateError";
  }
}

const MAX_STATUS_BYTES = 16 * 1024;

function channelDir(): string | null {
  return process.env.CHIBAKO_UPDATER_DIR || null;
}

export function currentVersion(): string | null {
  const version = versionSchema.safeParse(process.env.CHIBAKO_VERSION);
  return version.success ? version.data : null;
}

function readStatus(dir: string): UpdaterStatus | null {
  const file = path.join(dir, "out", "status.json");
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_STATUS_BYTES) return null;
    const parsed = statusSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function view(partial: Partial<UpdateView> & Pick<UpdateView, "state">): UpdateView {
  return { currentVersion: currentVersion(), latest: null, operation: null, message: null, checkAck: null, ...partial };
}

export function getUpdateView(nowMs = Date.now()): UpdateView {
  const dir = channelDir();
  if (!dir) return view({ state: "unmanaged", message: "Updates are managed outside this installation." });
  const status = readStatus(dir);
  if (!status || nowMs - status.heartbeatAt > STATUS_STALE_MS) {
    return view({ state: "unavailable", message: "The Chibako updater is not responding. Check that its container is running." });
  }
  const operation = status.operation
    ? { id: status.operation.id, phase: status.operation.phase, to: status.operation.to, error: status.operation.error, updatedAt: status.operation.updatedAt }
    : null;
  if (operation && !TERMINAL_PHASES.includes(operation.phase)) return view({ state: "updating", operation, latest: status.latest });
  const current = currentVersion();
  if (status.protocol !== UPDATER_PROTOCOL) {
    return view({ state: "unavailable", operation, message: "The updater is out of date. Re-run the Chibako installer to refresh it." });
  }
  const checkAck = status.checkAck ?? null;
  const latest = status.latest;
  const available = latest && current && compareVersions(latest.version, current) > 0;
  return view({
    state: available ? "available" : "current",
    latest: available ? latest : null,
    operation,
    message: status.checkError,
    checkAck,
  });
}

function dropRequest(dir: string, body: { id: string; [key: string]: unknown }): { requestId: string } {
  const inbox = path.join(dir, "in");
  if (fs.readdirSync(inbox).some((name) => REQUEST_FILE.test(name))) throw new UpdateError("An update request is already waiting.");
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) throw new UpdateError("Request too large.", 400);
  // Write then rename so the updater never reads a partial request.
  const temp = path.join(inbox, `.tmp-${body.id}`);
  fs.writeFileSync(temp, text, { flag: "wx", mode: 0o644 });
  fs.renameSync(temp, path.join(inbox, `request-${body.id}.json`));
  return { requestId: body.id };
}

/** Asks the updater to install exactly the release the owner saw. */
export function requestUpdate(version: string): { requestId: string } {
  const dir = channelDir();
  const parsed = versionSchema.safeParse(version);
  if (!parsed.success) throw new UpdateError("Invalid version.", 400);
  const current = getUpdateView();
  if (current.state !== "available" || current.latest?.version !== parsed.data) {
    throw new UpdateError(current.state === "updating" ? "An update is already in progress." : "That version is no longer the available update. Refresh and try again.");
  }
  const id = randomUUID();
  return dropRequest(dir!, { v: 1, id, action: "update", version: parsed.data });
}

/** Asks the updater to refetch the release manifest now. Never installs; the browser waits for `checkAck`. */
export function requestCheck(): { requestId: string } {
  const dir = channelDir();
  const current = getUpdateView();
  if (!dir || current.state === "unmanaged") throw new UpdateError("Updates are managed outside this installation.");
  if (current.state === "updating") throw new UpdateError("An update is already in progress.");
  if (current.state === "unavailable") throw new UpdateError(current.message ?? "The Chibako updater is not responding.");
  if (current.operation?.phase === "needs_attention") throw new UpdateError("The updater needs attention. Follow the recovery steps first.");
  return dropRequest(dir, { v: 1, id: randomUUID(), action: "check" });
}
