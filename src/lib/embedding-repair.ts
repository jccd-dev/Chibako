import { MaintenanceError } from "./db";
import { reindexEmbeddings } from "./embedding-index";

// ---------- scheduled embedding repair ----------
//
// Server-owned: started once by the Next.js instrumentation hook, never per
// request and never by the stdio MCP process. Staleness is derived from stored
// content hashes, so a restart finds the same stale Notes again. The circuit
// breaker lives in refreshNotes; an open breaker makes a pass embed nothing.

const INTERVAL_MS = 5 * 60_000;
const BATCH = 50;
const PASSES = 4; // bounded work per tick: at most BATCH * PASSES Notes

const runner = globalThis as typeof globalThis & { embeddingRepairTimer?: ReturnType<typeof setInterval> };

let running = false;

/** Reindex stale Notes in bounded batches. Resolves with the total embedded; never throws. A call while a run is in flight is skipped (indexed 0). */
export async function runEmbeddingRepair(opts: { batch?: number; passes?: number } = {}): Promise<{ indexed: number }> {
  if (running) return { indexed: 0 };
  let indexed = 0;
  running = true;
  try {
    for (let pass = 0; pass < (opts.passes ?? PASSES); pass++) {
      const result = await reindexEmbeddings({ max: opts.batch ?? BATCH });
      indexed += result.indexed;
      // Done, disabled, or the Provider stopped mid-pass (failure, limit): the next tick carries on instead of calling it again now.
      if (result.indexed < (opts.batch ?? BATCH) || result.remaining === 0) break;
    }
  } catch (error) {
    if (!(error instanceof MaintenanceError)) console.error(`Embedding repair failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  } finally {
    running = false;
  }
  return { indexed };
}

export function startEmbeddingRepair(): void {
  if (runner.embeddingRepairTimer) return;
  const tick = () => void runEmbeddingRepair();
  runner.embeddingRepairTimer = setInterval(tick, INTERVAL_MS);
  runner.embeddingRepairTimer.unref();
  tick();
}
