import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OPERATION_PHASES } from "../src/features/updates/protocol";
import { readBounded, writeFileAtomic } from "./files";

const metaSchema = z.object({ sha256: z.string(), bytes: z.number(), userVersion: z.number() });

export const operationSchema = z.object({
  id: z.string(),
  phase: z.enum(OPERATION_PHASES),
  from: z.string().nullable(),
  to: z.string(),
  targetRef: z.string(),
  previousPin: z.string().nullable(),
  /** Whether a rollback must also restore the data snapshot (false while data is untouched). */
  restoreData: z.boolean(),
  quarantined: z.boolean(),
  restored: z.boolean(),
  snapshot: metaSchema.nullable(),
  startedAt: z.number(),
  updatedAt: z.number(),
  error: z.string().nullable(),
}).strict();
export type Operation = z.infer<typeof operationSchema>;

const stateSchema = z.object({ v: z.literal(1), operation: operationSchema.nullable(), seen: z.array(z.string()).max(64) }).strict();
export type UpdaterState = z.infer<typeof stateSchema>;

/** Authoritative operation state. Lives in the updater-only control directory, never in the app channel. */
export class StateStore {
  private file: string;
  constructor(controlDir: string) { this.file = path.join(controlDir, "state.json"); }

  load(): UpdaterState {
    const text = fs.existsSync(this.file) ? readBounded(this.file, 256 * 1024) : null;
    if (text === null) return { v: 1, operation: null, seen: [] };
    return stateSchema.parse(JSON.parse(text));
  }

  save(state: UpdaterState): void {
    writeFileAtomic(this.file, JSON.stringify(state));
  }
}
