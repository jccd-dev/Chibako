// Preloaded into a Scoreboard CLI child. The timer stands in for a Provider answer that lands after the run: it keeps the
// process alive and, if it ever fires, does what a late answer does (opens the database path, recreating the deleted folder).
// The exit hook reports the Vault path so the test can check nothing was recreated.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

setTimeout(() => {
  const dir = process.env.CHIBAKO_DATA_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brain.db"), "");
}, 2500);
process.on("exit", () => writeFileSync(process.env.VAULT_PATH_FILE, process.env.CHIBAKO_DATA_DIR ?? ""));
