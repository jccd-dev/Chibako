import fs from "node:fs";
import { z } from "zod";

/**
 * Host-owned deployment target. It is mounted read-only into the updater and
 * never into the app, so a compromised app cannot redirect what gets run.
 */
const SAFE_PATH = /^\/[A-Za-z0-9._/-]{1,300}$/;
const absolutePath = z.string().regex(SAFE_PATH).refine((value) => !value.split("/").includes(".."), "no parent segments");
const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/);

export const configSchema = z.object({
  projectName: name,
  projectDir: absolutePath,
  composeFiles: z.array(absolutePath).min(1).max(8),
  envFiles: z.array(absolutePath).max(8).default([]),
  service: name,
  pinFile: absolutePath,
  pinVar: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  dataDir: absolutePath,
  backupDir: absolutePath,
  controlDir: absolutePath,
  lockFile: absolutePath,
  healthTimeoutSeconds: z.number().int().min(10).max(1800).default(180),
}).strict();
export type UpdaterConfig = z.infer<typeof configSchema>;

export function loadConfig(file: string): UpdaterConfig {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`${file} must be a regular file`);
  return configSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
