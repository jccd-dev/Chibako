// Preloaded into a Scoreboard CLI child. The timer stands in for a Provider answer that lands after the run: it keeps the
// process alive, so a CLI that waits for its event loop to drain lets later code run. The exit hook reports the Vault path.
import { writeFileSync } from "node:fs";

setTimeout(() => {}, 2500);
process.on("exit", () => writeFileSync(process.env.VAULT_PATH_FILE, process.env.CHIBAKO_DATA_DIR ?? ""));
