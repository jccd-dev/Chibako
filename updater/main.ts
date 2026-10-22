import { IMAGE_REPOSITORY, DIGEST, compareVersions } from "../src/features/updates/protocol";
import { loadConfig } from "./config";
import { initLayout } from "./init";
import { acquireLock } from "./lock";
import { advance, beginOperation, recoverOperation } from "./operation";
import type { Operation } from "./state";
import { fetchManifest } from "./manifest";
import { Updater } from "./updater";

const configPath = process.env.CHIBAKO_UPDATER_CONFIG ?? "/etc/chibako-updater/config.json";

/** Operator paths share the daemon's lock, so they can never overlap an update or an emergency deploy. */
async function locked(updater: Updater, work: () => Promise<number>): Promise<number> {
  const lock = await acquireLock(updater.ctx.config.lockFile);
  if (!lock) {
    console.error("Refused: another deployment or update is running.");
    return 75;
  }
  try {
    return await work();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  } finally {
    await lock.release();
  }
}

const report = (op: Operation | null, ok: string[] = ["succeeded"]) => {
  console.log(`${op?.phase}${op?.error ? `: ${op.error}` : ""}`);
  return op && ok.includes(op.phase) ? 0 : 1;
};

function apply(updater: Updater, ref: string): Promise<number> {
  // Operator/emergency path: same lock, snapshot, health gate and rollback as an owner click.
  const [repo, digest] = ref.split("@");
  if (repo !== IMAGE_REPOSITORY || !DIGEST.test(digest ?? "")) {
    console.error(`Refused: expected ${IMAGE_REPOSITORY}@sha256:<64 hex>.`);
    return Promise.resolve(64);
  }
  return locked(updater, async () => {
    await updater.ctx.docker.pull(ref);
    const version = await updater.ctx.docker.imageVersion(ref);
    if (!version) throw new Error("That image is not a versioned Chibako release.");
    const running = await updater.ctx.docker.runningImage();
    if (running?.version && compareVersions(version, running.version) < 0) throw new Error("Refusing to downgrade: restore a backup instead.");
    await beginOperation(updater.ctx, { version, digest });
    return report(await advance(updater.ctx));
  });
}

async function main(): Promise<void> {
  if (process.argv[2] === "init") {
    const home = process.env.CHIBAKO_HOME ?? "";
    if (!/^\/[A-Za-z0-9._/-]+$/.test(home) || home.split("/").includes("..")) throw new Error("CHIBAKO_HOME must be a safe absolute path.");
    initLayout(home, process.env.CHIBAKO_DATA_VOLUME || undefined);
    return;
  }
  const config = loadConfig(configPath);
  const updater = new Updater(config, { manifest: () => fetchManifest() });
  const [command = "daemon", argument] = process.argv.slice(2);
  if (command === "apply" && argument) process.exit(await apply(updater, argument));
  if (command === "recover") process.exit(await locked(updater, async () => report(await recoverOperation(updater.ctx), ["rolled_back"])));
  if (command !== "daemon") {
    console.error("Usage: updater [daemon | init | recover | apply <ghcr.io/jccd-dev/chibako@sha256:...>]");
    process.exit(64);
  }
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => controller.abort());
  await updater.run(controller.signal);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
