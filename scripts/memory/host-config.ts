import { MemoryClientError } from "./client-error";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MemoryProfile } from "./profile";

export const serverName = "chibako-memory";
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export function object(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}
/** Refuses to replace or remove a connection that setup did not write. */
export function assertOwned(current: string | null, previous?: MemoryProfile): void {
  if (current !== null && (!previous || digest(current) !== previous.host.digest)) throw new MemoryClientError("The chibako-memory connection already exists or was changed outside setup. Review it before replacing/removing it.");
  if (current === null && previous?.host.digest) throw new MemoryClientError("Managed connection was removed outside setup; review it before reconfiguring.");
}
/** Sets or removes the managed server inside a parsed host config object, leaving unrelated servers intact. */
export function setServer(data: Record<string, unknown>, field: string, connection: Record<string, unknown>, previous?: MemoryProfile, remove = false): string {
  const servers = data[field] === undefined ? {} : { ...object(data[field]) };
  assertOwned(servers[serverName] === undefined ? null : JSON.stringify(servers[serverName]), previous);
  if (remove) delete servers[serverName];
  else servers[serverName] = connection;
  data[field] = servers;
  return digest(JSON.stringify(connection));
}
/** Hand-installed memory hooks that would double-fire beside the packaged ones. */
export const manualHook = /scripts\/agent-memory|integrations\/agent-memory|memory\.mjs[^\n]*\b(?:codex|claude|hermes)\b/;
