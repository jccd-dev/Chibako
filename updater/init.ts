import fs from "node:fs";
import path from "node:path";
import { configSchema } from "./config";
import { writeFileAtomic } from "./files";

/**
 * Prepares the standard layout for the Docker-only path (the installer does the same
 * for the script path). Idempotent: existing directories and an existing config are kept.
 */
export function initLayout(home: string, dataDir = path.join(home, "data")): void {
  const config = configSchema.parse({
    projectName: "chibako", projectDir: home, composeFiles: [path.join(home, "compose.yml")],
    envFiles: [path.join(home, ".env"), path.join(home, "pin.env")], service: "chibako",
    pinFile: path.join(home, "pin.env"), pinVar: "CHIBAKO_IMAGE", dataDir,
    backupDir: path.join(home, "backups"), controlDir: path.join(home, "updater"),
    lockFile: path.join(home, "updater", ".deploy.lock"),
  });
  for (const dir of [config.dataDir, config.backupDir, path.join(config.controlDir, "channel", "out")]) fs.mkdirSync(dir, { recursive: true });
  const inbox = path.join(config.controlDir, "channel", "in");
  fs.mkdirSync(inbox, { recursive: true });
  fs.chmodSync(inbox, 0o1777); // the app runs as a different uid and must be able to drop requests
  fs.chmodSync(path.join(config.controlDir, "channel", "out"), 0o755);
  const file = path.join(config.controlDir, "config.json");
  if (!fs.existsSync(file)) writeFileAtomic(file, JSON.stringify(config, null, 2), 0o644);
}
