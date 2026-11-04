import { z } from "zod";

// Per-session hook cost: numbers only, kept in the device's private state files and never sent anywhere.
const count = z.number().int().min(0);
export const costSources = ["resume", "now", "recall", "instructions"] as const;
export const emptyCost = () => ({ injected: { resume: 0, now: 0, recall: 0, instructions: 0 }, checkpoint_requests: 0, captures: 0 });
// A malformed block resets to zero rather than failing the hook that reads it.
export const costSchema = z.object({
  injected: z.object({ resume: count, now: count, recall: count, instructions: count }),
  checkpoint_requests: count, captures: count,
}).catch(() => emptyCost());
export type Cost = z.infer<typeof costSchema>;

/** Applies a counter update; counting must never break the hook that triggered it. */
export function countCost(cost: Cost, update: (cost: Cost) => void): void {
  try { update(cost); } catch { /* shortcut: a lost count is acceptable, a failed hook is not */ }
}

export function sumCost(all: Cost[]): Cost {
  const total = emptyCost();
  for (const cost of all) {
    for (const source of costSources) total.injected[source] += cost.injected[source];
    total.checkpoint_requests += cost.checkpoint_requests;
    total.captures += cost.captures;
  }
  return total;
}
