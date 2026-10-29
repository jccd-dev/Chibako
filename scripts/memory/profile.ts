import { MemoryClientError } from "./client-error";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { privateDirectory, readOptional, atomicPrivateWrite } from "./private-files";
import type { HostAdapter } from "./host-adapter";

export const defaultThresholds = { user_turns: 4, tool_calls: 10 };
export type ActivityThresholds = typeof defaultThresholds;
export const profileSchema = z.object({
  version: z.literal(1), runtime: z.enum(["codex", "claude", "hermes"]), name: z.string(),
  endpoint: z.string(), api_key: z.string(), principal_id: z.string(), area: z.string(),
  enabled: z.boolean(), connected_at: z.string(),
  thresholds: z.object({ user_turns: z.number().int().min(1), tool_calls: z.number().int().min(1) }).strict().optional(),
  host: z.object({ file: z.string(), digest: z.string() }),
}).strict();
export type MemoryProfile = z.infer<typeof profileSchema>;

export function profileDirectory(host: HostAdapter, name: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new MemoryClientError("Profile name must use 1–64 letters, numbers, underscores or hyphens.");
  const override = process.env.CHIBAKO_MEMORY_PROFILE_DIR;
  if (override) {
    if (!path.isAbsolute(override)) throw new MemoryClientError("Profile directory must be absolute.");
    return override;
  }
  // Human terminal setup and native hooks must choose the same path without plugin-only environment variables.
  return path.join(host.home(), "chibako-memory", host.runtime, name);
}
export async function readProfile(directory: string): Promise<MemoryProfile | null> {
  const text = await readOptional(path.join(directory, "profile.json"));
  return text === null ? null : profileSchema.parse(JSON.parse(text));
}
export async function saveProfile(directory: string, profile: MemoryProfile): Promise<void> {
  await privateDirectory(directory);
  await atomicPrivateWrite(path.join(directory, "profile.json"), JSON.stringify(profileSchema.parse(profile), null, 2) + "\n");
}
async function stateSummary(directory: string): Promise<{ pending: number; last_verified_save: string | null }> {
  const state = path.join(directory, "state");
  let files: string[];
  try { files = await readdir(state); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { pending: 0, last_verified_save: null };
    throw error;
  }
  let count = 0;
  let last: string | null = null;
  for (const file of files.filter((value) => value.endsWith(".json"))) {
    const text = await readOptional(path.join(state, file));
    const record = z.object({ pending: z.unknown().optional(), last_saved_at: z.string().datetime().optional() }).passthrough().parse(JSON.parse(text || "null"));
    if (record.pending) count++;
    if (record.last_saved_at && (!last || record.last_saved_at > last)) last = record.last_saved_at;
  }
  return { pending: count, last_verified_save: last };
}
export async function pendingCount(directory: string): Promise<number> {
  return (await stateSummary(directory)).pending;
}
export async function localStatus(directory: string): Promise<object> {
  const profile = await readProfile(directory);
  return {
    installed: true, configured: Boolean(profile?.api_key), enabled: profile?.enabled ?? false,
    runtime: profile?.runtime ?? null, profile: profile?.name ?? null, area: profile?.area ?? null,
    connection_checked_at: profile?.connected_at ?? null, ...(await stateSummary(directory)),
    capture_verified: false, host_verification: "pending actual-host pilot",
  };
}
