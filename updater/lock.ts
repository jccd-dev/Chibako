import { spawn } from "node:child_process";

export interface Lock { release(): Promise<void> }

/**
 * Cross-process operation lock using flock(1) on the same file the host-side
 * deploy tooling locks, so an update and an emergency deploy can never overlap.
 * The child keeps the lock while its stdin stays open and exits (releasing it)
 * if this process dies.
 */
export function acquireLock(file: string): Promise<Lock | null> {
  return new Promise((resolve, reject) => {
    const child = spawn("flock", ["-n", "-E", "75", file, "sh", "-c", "echo locked; cat >/dev/null"], { stdio: ["pipe", "pipe", "ignore"] });
    let settled = false;
    const closed = new Promise<void>((done) => child.on("close", () => done()));
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || !chunk.toString().includes("locked")) return;
      settled = true;
      resolve({ release: async () => { child.stdin.end(); await closed; } });
    });
    child.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 75) resolve(null); else reject(new Error(`flock exited with ${code}`));
    });
  });
}
